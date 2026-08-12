import { runPipeline, type OcrRequest, type PipelineDeps } from "../src/pipeline";
import { MockLlmClient } from "../src/llm/azure";
import { PlainTextProvider } from "../src/providers/plain-text";
import { noopCache } from "../src/cache";
import { defaultProviderPolicy } from "../src/config/providers";
import { logger } from "../src/observability/logger";
import type { DocumentInput, OcrProvider, RecognizedDocument, RecognizeOptions } from "../src/providers/types";

/**
 * Shared building blocks for the per-function integration tests. Each test drives
 * the real `runPipeline` with a deterministic {@link MockLlmClient}, so coverage
 * exercises routing + interpretation + validation exactly as production does, minus
 * the live vendors. Mirrors the inline helpers in `pipeline.test.ts` /
 * `auto-extraction.test.ts`, factored out so eight function tests don't repeat them.
 */

/** 1x1 transparent PNG — a real, sniffable image payload (image-accepting functions). */
export const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** A canonical RecognizedDocument carrying `markdown`; override any field (e.g. `blocks`). */
export const makeDoc = (markdown: string, over: Partial<RecognizedDocument> = {}): RecognizedDocument => ({
  markdown,
  plainText: markdown,
  pages: [{ page: 1, markdown }],
  blocks: [],
  pageCount: 1,
  provider: "glm-ocr",
  durationMs: 0,
  ...over,
});

/** A layout-capable provider named `glm-ocr` that yields `markdown` (+ optional overrides). */
export const fakeProvider = (markdown: string, over: Partial<RecognizedDocument> = {}): OcrProvider => ({
  name: "glm-ocr",
  accepts: ["image", "pdf"],
  capabilities: ["text", "layout", "tables", "handwriting", "seals"],
  recognize: async (_i: DocumentInput, _o: RecognizeOptions) => makeDoc(markdown, over),
});

/** Pipeline deps with sensible defaults (plain-text provider, no-op cache); override per test. */
export const deps = (over: Partial<PipelineDeps> = {}): PipelineDeps => ({
  llm: new MockLlmClient(),
  logger,
  providers: [new PlainTextProvider()],
  cache: noopCache,
  policy: defaultProviderPolicy,
  ...over,
});

/** An OcrRequest for `buffer` with `args`; defaults to a `.png` upload name. */
export const request = (buffer: Buffer, args: unknown = {}, originalName = "upload.png"): OcrRequest => ({
  file: { buffer, originalName },
  args,
  requestId: "req_test",
  tenantId: "tenant_test",
});

/** A MockLlmClient seeded from `[schemaName, response]` pairs. */
export const mockLlm = (entries: [string, unknown][]): MockLlmClient =>
  new MockLlmClient(new Map<string, unknown>(entries));

export { runPipeline };
