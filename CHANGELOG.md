# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Function catalog architecture** — `POST /v1/ocr/:function` with a shared
  extraction stage and per-function interpretation; `GET /v1/ocr/functions` returns
  JSON Schemas for args and result per function.
- **Functions**: `TEXT_EXTRACTION`, `DOCUMENT_CLASSIFICATION`, `RECEIPT_PARSING`,
  `FORM_DATA_EXTRACTION`, `RESUME_PARSING`, `ID_VERIFICATION`, `SIGNING`,
  `DOCUMENT_AUTHENTICITY`.
- **Extraction providers**: plain-text, `pdf-parse`, `mammoth` (DOCX), and Tesseract,
  behind a capability-matching router with fallback chains.
- **Interpretation layer** on Azure OpenAI structured outputs (`json_schema`),
  re-validated against Zod result schemas.
- **Deterministic post-validation**: MRZ checksum parsing (`ID_VERIFICATION`) and
  receipt total reconciliation (`RECEIPT_PARSING`).
- **`DOCUMENT_AUTHENTICITY`** deterministic tamper analysis (PDF structure/signature/
  metadata, image editor fingerprints/EXIF) with a `heuristic-only` assurance level.
- **GLM-OCR provider** wired end-to-end (layout-aware, seal/stamp capable) behind a
  `GLM_ENABLED` flag: bounded-retry client, PDF-page chunker, and `layout_parsing`
  response mapper. When disabled it is absent from the registry and image/scanned-PDF
  chains fall back to Tesseract.
- **Async processing**: requests over the size/page thresholds route to a BullMQ
  queue (`202` + `statusUrl`), a worker (`node build/worker.js`) runs the identical
  pipeline off-request, and `GET /v1/ocr/jobs/:id` reports tenant-scoped status/result.
  `pii`/`restricted` files are never enqueued.
- **Redis extraction cache** wired (fail-open): the extraction stage is cached by
  content hash so the same document across functions pays for extraction once; skipped
  for `sensitivity: "pii"`.
- **Admin console** (`/admin`): session-cookie authentication with argon2id password
  hashing, role-based access control, and a first-party dashboard (`public/admin`) for
  managing tenants and admins. Bootstrap admin is seeded from env at startup.
- **Observability**: OpenTelemetry tracing (OTLP/HTTP export, config-gated by
  `OTEL_EXPORTER_OTLP_ENDPOINT`) alongside `prom-client` metrics served at `/metrics`.
- **Security**: Postgres-backed API-key auth (keys stored only as sha256, keyed by the
  hash so a DB dump can't be replayed; fail-closed), per-function authorization,
  per-tenant rate limiting (fail-open), `pii` handling (log/trace redaction, `no-store`,
  no caching), default-closed CORS, magic-byte type sniffing, and untrusted-content
  guards against document-borne prompt injection.
- **Provisioning CLIs**: `pnpm provision:tenant` and `pnpm provision:admin` for runtime
  create/revoke.
- **Configuration** validated at startup via Zod (`src/config/env.ts`), loaded through
  `dotenv`; `.env.example` documents every variable.

### Changed

- **`SIGNING` no longer requires the `seals` capability, and runs without GLM-OCR.**
  It declared `requires: ["layout", "seals"]`, which only GLM satisfies, so with
  `GLM_ENABLED=false` every request failed provider routing and returned `500`.
  `requires` is now `["layout"]` — a floor, not a guarantee. GLM is still preferred
  and still takes the precise path (locate signature regions, judge each from its own
  crop, `confidence: "high"`). Without `seals`, `execute` switches to a whole-page
  vision pass that both locates and judges blocks, reporting `confidence: "low"`, a
  warning naming the degraded path, and blocks with no `bbox`. Bounded by the new
  `maxVisionPages` arg (default 3).
- **`signingResultSchema` gains `confidence` and `warnings`**, matching the rest of the
  catalog, and `blocks[].bbox` is now **optional** (absent on the whole-page path).
  Callers reading `bbox` unconditionally must handle `undefined`. `SIGNING` also gains
  `confidenceOf`, so degraded runs surface on the `ocr_low_confidence_ratio` SLI.
- **`OcrContext` gains `capabilities`** — the capabilities of the provider that actually
  ran, resolved after any fallback. Lets a function detect a degraded extraction path
  and adapt instead of emitting a confident wrong answer off missing block labels.
- **Storage migrated from Redis to Postgres** for the tenant and admin registries
  (`src/db.ts`). Redis is retained for rate limiting, the extraction cache, and the
  BullMQ queue.
- **`provision:admin` requires `--email` and `--password`.** They previously defaulted
  to a literal pair in the script, so a bare `create` minted an **owner** whose
  password was published in this repository. The command is now documented as a
  lockout-recovery tool rather than the way to make an admin.

### Removed

- **`pnpm provision:tenant`.** Tenants and API keys are managed from the admin console
  and the tenant portal, which also attribute each change to the signed-in admin
  rather than to a `--actor` flag. The first console owner is seeded on boot by
  `ensureBootstrapAdmin`, so neither CLI is part of normal setup any more.

### Notes

All previously staged integration seams — the GLM-OCR provider, the Redis extraction
cache, and the async BullMQ queue/worker — are now wired and test-covered. See
[TECHNICAL.md § Wiring status](./TECHNICAL.md#wiring-status).

[Unreleased]: https://github.com/
