import type { DocumentInput, OcrProvider, RecognizedDocument, RecognizeOptions } from "./providers/types";
import { resolveResultSchema, type OcrContext, type OcrFunctionDefinition } from "./functions/define";
import { createRedactingLogger, type Logger } from "./observability/logger";
import { extractionCacheKey, type ExtractionCache } from "./cache";
import { recordFunctionUsage, recordTenantUsage } from "./observability/usage";
import { isRecordable, recordDocument } from "./observability/documents";
import { blobStorageEnabled, putDocument } from "./storage/blob";
import { dispatchDocumentEvent } from "./webhooks/dispatch";
import type { ProviderPolicy } from "./config/providers";
import { withSpan } from "./observability/tracing";
import { routeProvider } from "./providers/router";
import { metrics } from "./observability/metrics";
import { sha256, sniff } from "./ingest/sniff";
import type { LlmClient } from "./llm/azure";
import { OcrError } from "./http/errors";
import { env } from "./config/env";

/**
 * The per-request pipeline:
 *   1. Ingest    multipart → sniff → validate
 *   2. Extract   provider router → RecognizedDocument (cache-backed)
 *   3. Interpret function.execute(ctx, args)
 *   4. Validate  Zod + business rules → result
 *
 * The same code path serves sync and async (the queue worker just calls this
 * off-request), so the orchestration lives in one place.
 */
export type OcrRequest = {
  file: { buffer: Buffer; originalName: string };
  args: unknown;
  requestId: string;
  tenantId: string;
  /**
   * Per-document page ceiling from the tenant's subscription (the plan's
   * `effectiveLimits.maxPagesPerDocument`, trial cap already folded in), snapshotted
   * by the route handler at submission. `null`/absent means no plan cap. Enforced in
   * the pipeline alongside the function's own `maxPages`, so it also holds across the
   * async queue boundary (the worker runs the same request off-line).
   */
  planMaxPages?: number | null;
};

export type OcrResponseMeta = {
  provider: string;
  fellBackFrom: string | null;
  pageCount: number;
  cached: boolean;
  confidence?: number;
  durationMs: number;
  tokensUsed?: number;
};

export type OcrOutcome<TResult> = {
  result: TResult;
  meta: OcrResponseMeta;
};

export type PipelineDeps = {
  llm: LlmClient;
  logger: Logger;
  providers: readonly OcrProvider[];
  cache: ExtractionCache;
  policy: ProviderPolicy;
};

type ExtractOutput = { doc: RecognizedDocument; cached: boolean };

/**
 * Runs a request end to end against a resolved function definition.
 *
 * @throws OcrError with a typed {@link import("./http/errors").OcrErrorCode}.
 */
export const runPipeline = async <TArgs, TResult>(
  def: OcrFunctionDefinition<TArgs, TResult>,
  req: OcrRequest,
  deps: PipelineDeps,
): Promise<OcrOutcome<TResult>> => {
  const start = Date.now();
  // Declared outside the try so the error path can label metrics with however far
  // the request got (mime group/provider are unknown if it failed during ingest).
  let input: DocumentInput | undefined;
  let doc: RecognizedDocument | undefined;
  let cached = false;
  let ingestMs = 0;
  let interpretMs = 0;

  try {
    const args = parseArgs(def, req.args);

    const ingestStart = Date.now();
    input = await ingest(req);
    ingestMs = Date.now() - ingestStart;

    if (!def.accepts.includes(input.mimeGroup)) {
      throw new OcrError("UNSUPPORTED_MEDIA_TYPE", `${def.key} does not accept ${input.mimeGroup} files`);
    }

    const opts: RecognizeOptions = { requestId: req.requestId, userIdHash: req.tenantId };
    const extracted = def.skipExtraction
      ? { doc: emptyDocument(), cached: false }
      : await extractDocument(def, input, opts, deps);
    doc = extracted.doc;
    cached = extracted.cached;

    if (doc.pageCount > def.maxPages) {
      throw new OcrError("PAGE_LIMIT_EXCEEDED", `${def.key} allows ${def.maxPages} pages; got ${doc.pageCount}`);
    }
    // Per-subscription page ceiling, layered on top of the function's own cap. May be
    // tighter than `def.maxPages` (e.g. a trial); reported separately so the caller
    // knows the limit is a plan constraint, not the function's.
    if (req.planMaxPages != null && doc.pageCount > req.planMaxPages) {
      throw new OcrError(
        "PAGE_LIMIT_EXCEEDED",
        `Your plan allows ${req.planMaxPages} pages per document; got ${doc.pageCount}`,
      );
    }

    // `pii`/`restricted` functions get a redacting logger so raw document text and
    // extracted identity fields can never reach the log sink (V2). Enforced here —
    // the single point the context logger is built — so it can't be bypassed.
    const isSensitive = def.sensitivity !== "standard";
    const requestLogger = deps.logger.child({ requestId: req.requestId, function: def.key });

    // `doc` is a mutable `let` (the error path reads it), so narrowing does not
    // survive into the closure below; bind it once here.
    const recognized = doc;

    const ctx: OcrContext = {
      doc: recognized,
      // Resolved by name from the injected registry so this tracks the provider that
      // actually ran (`doc.provider` is set by the fallback chain, not the router's
      // first choice). Empty for `skipExtraction` functions, which have no provider.
      capabilities: deps.providers.find((p) => p.name === recognized.provider)?.capabilities ?? [],
      file: {
        sha256: input.sha256,
        mimeGroup: input.mimeGroup,
        sizeBytes: input.buffer.length,
        originalName: input.originalName,
        buffer: input.buffer,
      },
      requestId: req.requestId,
      tenantId: req.tenantId,
      llm: deps.llm,
      logger: isSensitive ? createRedactingLogger(requestLogger) : requestLogger,
    };

    // For sensitive functions, disable response-body capture in the trace (V2).
    const interpretStart = Date.now();
    const result = await withSpan(`interpret:${def.key}`, () => interpret(def, ctx, args), {
      captureResult: !isSensitive,
      attributes: { function: def.key, sensitivity: def.sensitivity },
    });
    interpretMs = Date.now() - interpretStart;

    // Quality SLI: functions that carry a confidence signal expose `confidenceOf`;
    // the pipeline is the single place it's read and turned into a metric.
    const confidence = def.confidenceOf?.(result);
    const lowConfidence = confidence === undefined ? undefined : confidence <= env.LOW_CONFIDENCE_THRESHOLD;
    if (lowConfidence !== undefined) {
      metrics.recordConfidence(def.key, lowConfidence);
    }

    // Cost SLI: priced off the tokens we can see (extraction); 0-rate disables it.
    const estimatedCostNgn =
      doc.tokensUsed && env.LLM_COST_NGN_PER_1K_TOKENS
        ? (doc.tokensUsed / 1000) * env.LLM_COST_NGN_PER_1K_TOKENS
        : undefined;

    const meta: OcrResponseMeta = {
      provider: doc.provider,
      fellBackFrom: doc.fellBackFrom ?? null,
      pageCount: doc.pageCount,
      cached,
      confidence,
      durationMs: Date.now() - start,
      tokensUsed: doc.tokensUsed,
    };
    metrics.recordRequest({
      function: def.key,
      mimeGroup: input.mimeGroup,
      pageCount: doc.pageCount,
      provider: doc.provider,
      fellBackFrom: doc.fellBackFrom,
      cached,
      ingestMs,
      extractMs: doc.durationMs,
      interpretMs,
      tokensUsed: doc.tokensUsed,
      estimatedCostNgn,
      outcome: "success",
    });
    // Durable counters for the admin console (fire-and-forget; see usage.ts). These
    // shadow the Prometheus series deliberately: the registry is per-process and
    // resets on deploy, so the console reads these instead.
    recordTenantUsage(req.tenantId, { outcome: "success", tokensUsed: doc.tokensUsed });
    recordFunctionUsage(def.key, {
      outcome: "success",
      tokensUsed: doc.tokensUsed,
      lowConfidence,
      fellBack: doc.fellBackFrom !== undefined,
    });
    // Metadata for the portal's document list, and — when blob storage is on — the
    // archived source file. Both no-op for `pii`/`restricted` functions: `archive`
    // gates on the same rule the registry owns, so the bytes of a sensitive document
    // are never uploaded.
    archiveAndRecord(def, req, {
      pageCount: doc.pageCount,
      outcome: "success",
      provider: doc.provider,
      tokensUsed: doc.tokensUsed ?? null,
      durationMs: meta.durationMs,
      mimeType: input.mime,
    });

    return { result, meta };
  } catch (err) {
    // Count the failed request so `ocr_requests_total{outcome="error"}` reflects
    // failures too; the histograms are left to successes (see metrics.recordRequest).
    metrics.recordRequest({
      function: def.key,
      mimeGroup: input?.mimeGroup ?? "unknown",
      pageCount: doc?.pageCount ?? 0,
      provider: doc?.provider ?? "none",
      fellBackFrom: doc?.fellBackFrom,
      cached,
      ingestMs,
      extractMs: doc?.durationMs ?? 0,
      interpretMs,
      tokensUsed: doc?.tokensUsed,
      outcome: "error",
    });
    recordTenantUsage(req.tenantId, { outcome: "error", tokensUsed: doc?.tokensUsed });
    // No `lowConfidence` on the error path: the request never produced a result to
    // score, so it must not enter the ratio's denominator.
    recordFunctionUsage(def.key, {
      outcome: "error",
      tokensUsed: doc?.tokensUsed,
      fellBack: doc?.fellBackFrom !== undefined,
    });
    // Failures are listed too: "we sent it and it bounced" is the case a tenant is
    // most likely to come looking for — and the one where having the original file
    // to re-run is most useful.
    archiveAndRecord(def, req, {
      pageCount: doc?.pageCount ?? 0,
      outcome: "error",
      provider: doc?.provider ?? null,
      tokensUsed: doc?.tokensUsed ?? null,
      durationMs: null,
      mimeType: input?.mime,
    });
    throw err;
  }
};

/**
 * Archives the source file (when enabled) and records the registry row.
 *
 * Runs off the response path — the request has already been answered by the time
 * this settles, so an upload to object storage never adds latency to the OCR call
 * and never turns a successful extraction into a failed request. Both steps are
 * individually best-effort: a failed upload just leaves `storageKey` null, and the
 * document still lists.
 *
 * The sensitivity check happens here rather than being left to `recordDocument`,
 * because the upload has to be skipped too — otherwise the bytes of a `pii`
 * document would reach the bucket even though no row ever mentions them.
 */
const archiveAndRecord = <TArgs, TResult>(
  def: OcrFunctionDefinition<TArgs, TResult>,
  req: OcrRequest,
  outcome: {
    pageCount: number;
    outcome: "success" | "error";
    provider: string | null;
    tokensUsed: number | null;
    durationMs: number | null;
    mimeType?: string;
  },
): void => {
  // Webhooks fire for *every* sensitivity — a tenant subscribed to document events
  // should hear about a PII run too. The payload is what differs: `dispatch` withholds
  // the filename for pii/restricted, so the event says "this happened" without saying
  // what the document was called.
  void dispatchDocumentEvent({
    tenantId: req.tenantId,
    functionKey: def.key,
    sensitivity: def.sensitivity,
    outcome: outcome.outcome,
    pageCount: outcome.pageCount,
    fileName: req.file.originalName,
    requestId: req.requestId,
  });

  if (!isRecordable(def.sensitivity)) return;

  const record = (storageKey?: string): void => {
    void recordDocument({
      tenantId: req.tenantId,
      functionKey: def.key,
      sensitivity: def.sensitivity,
      fileName: req.file.originalName,
      byteSize: req.file.buffer.byteLength,
      pageCount: outcome.pageCount,
      outcome: outcome.outcome,
      provider: outcome.provider,
      tokensUsed: outcome.tokensUsed,
      durationMs: outcome.durationMs,
      storageKey,
    });
  };

  // With storage off — the default — record synchronously. Putting the call behind
  // an `await` would defer it to a later microtask, which defeats `recordDocument`'s
  // synchronous error handling and lets a store failure surface long after the
  // request it belongs to has finished (see the note on `recordDocument`).
  if (!blobStorageEnabled()) {
    record();
    return;
  }
  // Storage on: the key is only known once the upload settles, so this path defers.
  void putDocument({
    tenantId: req.tenantId,
    fileName: req.file.originalName,
    body: req.file.buffer,
    contentType: outcome.mimeType,
  }).then(record);
};

/** Placeholder document for `skipExtraction` functions that work on raw bytes. */
const emptyDocument = (): RecognizedDocument => ({
  markdown: "",
  plainText: "",
  pages: [],
  blocks: [],
  pageCount: 0,
  provider: "none",
  durationMs: 0,
});

/** Stage 1: sniff + hash into a canonical {@link DocumentInput}. */
const ingest = async (req: OcrRequest): Promise<DocumentInput> => {
  const buffer = req.file.buffer;
  const sniffed = await sniff(buffer);
  if (!sniffed) {
    throw new OcrError("UNSUPPORTED_MEDIA_TYPE", "Could not determine a supported file type");
  }
  return {
    buffer,
    mimeGroup: sniffed.mimeGroup,
    mime: sniffed.mime,
    sha256: sha256(buffer),
    originalName: req.file.originalName,
  };
};

/** Stage 2: route → cache lookup → recognize (with fallback) → cache store. */
const extractDocument = async <TArgs, TResult>(
  def: OcrFunctionDefinition<TArgs, TResult>,
  input: DocumentInput,
  opts: RecognizeOptions,
  deps: PipelineDeps,
): Promise<ExtractOutput> => {
  const { provider, fallbacks } = routeProvider(deps.providers, {
    group: input.mimeGroup,
    required: def.requires,
    fn: def.key,
    policy: deps.policy,
  });

  const usesCache = def.sensitivity === "standard";
  const key = extractionCacheKey(input.sha256, provider.name);

  if (usesCache) {
    const hit = await deps.cache.get(key);
    if (hit) return { doc: hit, cached: true };
  }

  const doc = await recognizeWithFallback(provider, fallbacks, input, opts, deps);

  if (usesCache) {
    await deps.cache.set(extractionCacheKey(input.sha256, doc.provider), doc, env.EXTRACTION_CACHE_TTL_SECONDS);
  }
  return { doc, cached: false };
};

/** Tries the primary provider, then each fallback on error, stamping `fellBackFrom`. */
const recognizeWithFallback = async (
  primary: OcrProvider,
  fallbacks: OcrProvider[],
  input: DocumentInput,
  opts: RecognizeOptions,
  deps: PipelineDeps,
): Promise<RecognizedDocument> => {
  const chain = [primary, ...fallbacks];
  let lastError: unknown;

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i]!;
    try {
      const doc = await provider.recognize(input, opts);
      if (i > 0) {
        doc.fellBackFrom = primary.name;
        metrics.incrementFallback(primary.name, provider.name);
        deps.logger.warn("provider fallback", { from: primary.name, to: provider.name });
      }
      return doc;
    } catch (err) {
      lastError = err;
      deps.logger.error("provider failed", {
        provider: provider.name,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  throw new OcrError("EXTRACTION_FAILED", `All providers failed: ${chain.map((p) => p.name).join(", ")}`, {
    retryable: true,
    details: lastError instanceof Error ? lastError.message : String(lastError),
  });
};

/** Stage 3 + 4: run the function, then validate its output against the (possibly dynamic) result schema. */
const interpret = async <TArgs, TResult>(
  def: OcrFunctionDefinition<TArgs, TResult>,
  ctx: OcrContext,
  args: TArgs,
): Promise<TResult> => {
  let raw: TResult;
  try {
    raw = await def.execute(ctx, args);
  } catch (err) {
    if (err instanceof OcrError) throw err;
    throw new OcrError("INTERPRETATION_FAILED", `${def.key} execution failed`, {
      retryable: false,
      details: err instanceof Error ? err.message : String(err),
    });
  }

  const parsed = resolveResultSchema(def, args).safeParse(raw);
  if (!parsed.success) {
    throw new OcrError("SCHEMA_VALIDATION_FAILED", `${def.key} produced an invalid result`, {
      retryable: false,
      details: parsed.error.issues,
    });
  }
  return parsed.data;
};

const parseArgs = <TArgs, TResult>(def: OcrFunctionDefinition<TArgs, TResult>, raw: unknown): TArgs => {
  const parsed = def.argsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new OcrError("INVALID_ARGS", "Invalid function arguments", {
      retryable: false,
      details: parsed.error.issues,
    });
  }
  return parsed.data;
};

/** Runs only stages 1–2, producing the canonical document (used for cache warming / debugging). */
export const extract = async <TArgs, TResult>(
  def: OcrFunctionDefinition<TArgs, TResult>,
  req: OcrRequest,
  deps: PipelineDeps,
): Promise<RecognizedDocument> => {
  const input = await ingest(req);
  const opts: RecognizeOptions = { requestId: req.requestId, userIdHash: req.tenantId };
  const { doc } = await extractDocument(def, input, opts, deps);
  return doc;
};
