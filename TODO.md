# Heirs OCR — Outstanding Work

The **synchronous path is fully wired** end-to-end (ingest → extract → interpret →
validate, plus auth, authorization, rate-limiting, PII handling, and CORS). The items
below are integration seams that are deliberately stubbed and throw a clear error until
connected. See [`docs/architecture.md § Not yet wired`](./docs/architecture.md#not-yet-wired).

Ordered by impact.

## 1. Implement GLM-OCR provider

Primary OCR engine for images/scanned PDFs. Gate behind `GLM_ENABLED`.
See [`docs/glm-ocr.md`](./docs/glm-ocr.md).

- [x] `src/providers/glm/client.ts` — `fetch` to GLM layout-parsing API with retry/backoff
- [x] `src/providers/glm/chunker.ts` — `splitPdfToPageImages` (render pages → PNG base64) + `mapWithConcurrency`
- [x] `src/providers/glm/mapper.ts` — flatten `layout_details` → `LayoutBlock[]`/pages; unknown labels degrade, don't throw
- [x] `src/providers/glm/index.ts` — wire chunk → concurrent calls → map

> Registry now gates `GlmOcrProvider` behind `GLM_ENABLED` (`src/providers/index.ts`); when off it is
> absent and the router falls image/scanned-PDF to Tesseract.

## 2. Implement SIGNING function — _done_

- [x] `src/functions/signing/execute.ts` — locate image blocks → correlate signature/seal cues → (geometryOnly? return blocks) → vision judge crops. Needs GLM layout + seal strength.

> Vision transport: `LlmClient`/`StructuredRequest` gained an optional `images?: string[]` (data URIs);
> `AzureLlmClient` sends multimodal content, `MockLlmClient` ignores it. Crops are self-cut from the raw
> bytes with `sharp` (bbox + `pdf-to-img` page raster) — provider-independent, no dependence on GLM's
> crop response shape. `sharp` added as a dependency (installed with `--legacy-peer-deps` due to a
> pre-existing `knip`/eslint peer conflict in the tree).

## 3. Implement Redis extraction cache — _done_

Replaces the injected `noopCache`; delivers the "OCR once, reuse across functions" saving.

- [x] `src/cache.ts` — `RedisExtractionCache` backed by `env.REDIS_URL`, keyed on file sha256, JSON de/serialization
- [x] `src/http/deps.ts` — inject the Redis cache in place of `noopCache`

> Fail-open like the rate limiter: a Redis/parse error degrades to a miss on `get` and a swallowed warning
> on `set` — a cache outage never becomes a request outage. `noopCache` retained for tests. Caching still
> gated to `sensitivity: "standard"` in the pipeline, so `pii` never touches the cache.

## 4. Wire async queue + worker + job lookup — _done_

Sync path is live; async submission now connected end-to-end.

- [x] `src/jobs/queue.ts` — BullMQ-backed `enqueue`/`getStatus` using `env.REDIS_URL`
- [x] `src/jobs/worker.ts` — `processJob` (getFunction → runPipeline → persist) + `startWorker`
- [x] `src/http/routes.ts` — `GET /v1/ocr/jobs/:id` lookup (auth + tenant-scoped; 404 on miss/cross-tenant)
- [x] `src/http/routes.ts` — POST routes over-threshold requests to `ocrQueue.enqueue` → 202 `sendAccepted`
- [x] `src/worker.ts` — dedicated worker entrypoint (`pnpm worker` / `pnpm worker:dev`) with graceful shutdown

> Notes:
> - BullMQ uses a dedicated connection (`maxRetriesPerRequest: null`), separate from the fail-fast
>   rate-limiter client. Job `file.buffer` is JSON-revived to a real `Buffer` in the worker.
> - `OcrError` codes are encoded into `failedReason` (`CODE: message`) and decoded in `getStatus`, since
>   Redis only persists the failure message.
> - Added a `NOT_FOUND` (404) error code for job lookup.
> - **Async submission is gated to `sensitivity: "standard"`** — `pii`/`restricted` files are never
>   persisted into the Redis-backed queue, mirroring the extraction-cache gate. The decision is made
>   pre-extraction from byte size + (for PDFs) a cheap `pdf-lib` page count.

## 5. Export metrics and tracing — _done_

- [x] `src/observability/metrics.ts` — backed by `prom-client` (dedicated registry + Node defaults); `/metrics` exposed in `main.ts`
- [x] `src/observability/tracing.ts` — real OpenTelemetry spans (attributes, OK/ERROR status + exception, duration)

> Notes:
> - New `src/observability/otel.ts` registers a `NodeTracerProvider`; exports via OTLP/HTTP when
>   `OTEL_EXPORTER_OTLP_ENDPOINT` is set, else console in development, else no exporter (spans still
>   created). `initTracing()` is called from both `index.ts` and `worker.ts`; the worker flushes on
>   shutdown. Added `OTEL_EXPORTER_OTLP_ENDPOINT` to the env schema.
> - `withSpan` never attaches the result payload — `captureResult` is recorded as an attribute only, so a
>   `pii` span cannot leak the response body.
> - The low-confidence SLI is exposed as two component counters (`ocr_low_confidence_total` /
>   `ocr_confidence_observations_total`); the ratio is a derived query.
> - `/metrics` is unauthenticated like the health probes (labels carry no tenant data). Verified at
>   runtime: 200 + Prometheus text, all custom + default series present.

## 6. Add test suite and restore CI test step — _done_

- [x] Added Vitest (`test` → `vitest run`, `test:watch`, `vitest.config.ts`)
- [x] Cover the pipeline, deterministic validators (MRZ, receipt reconciliation), auth/authorization, and router fallback logic — **33 tests across 6 files**
- [x] Restore the test (and lint) step in the CI workflow

> Coverage map (`test/`):
> - `router.test.ts` — routing + fallback chains, capability filtering (seals ⇒ GLM-only), no-provider throw
> - `mrz.test.ts` — valid TD3 checksum, tampered check digit ⇒ invalid, no-MRZ ⇒ undefined
> - `receipt-validate.test.ts` — totals reconciliation, low-confidence downgrade, relative-epsilon tolerance
> - `authorize.test.ts` — per-function allow-list (allow/empty/forbidden)
> - `auth.test.ts` — key hashing/generation, missing-key rejection
> - `pipeline.test.ts` — TEXT_EXTRACTION end-to-end, UNSUPPORTED_MEDIA_TYPE, fallback stamping,
>   all-providers-fail, DOCUMENT_CLASSIFICATION via `MockLlmClient` + low-confidence collapse
>
> Notes:
> - `lint` script added (`prettier --check` + `tsc --noEmit`); no eslint config existed, so lint = format
>   + typecheck. CI now runs Lint → Test → Build.
> - The MRZ fixture uses a real ISO country code (`NGA`); the `mrz` package validates country codes, so
>   ICAO's fictional `UTO` specimen fails despite valid checksums.
