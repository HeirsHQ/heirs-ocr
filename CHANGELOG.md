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
- **`RECEIPT_PARSING` `lineItemMode` arg** — `"multiple"` (default) returns the receipt
  itemized as printed; `"single"` collapses it to one line carrying the subtotal, for
  callers that book an upload as a single expense. Purely a reporting choice: the
  receipt is always parsed itemized and collapsed only afterwards, so totals
  reconciliation still runs against the real printed lines and a receipt that doesn't
  add up is still returned with `confidence: "low"`.
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
- **Webhooks**: owners register `https` endpoints subscribed to `document.processed` /
  `document.failed`; a background worker delivers them with an HMAC-SHA256 signature
  (`X-Heirs-Signature`, timestamp inside the signed string), a delivery id stable across
  retries so receivers can dedupe, bounded exponential-backoff retry, and a per-tenant
  delivery log. Capped at **10 endpoints per org** (`409 LIMIT_REACHED`) — each one
  multiplies the outbound fan-out of every document processed.
- **Webhooks are plan-gated** (`business`, `enterprise`): create, update, rotate-secret
  and test answer `403 NOT_ENTITLED` without the feature, and dispatch re-checks
  entitlement, so a downgrade stops delivery rather than leaving grandfathered endpoints
  firing. List, the delivery log and delete stay open on every plan — a tenant who
  downgrades must still be able to see what they have and take it down. A tenant with no
  subscription row is unlimited, as everywhere else; the gate fails closed
  (`503 PROVIDER_UNAVAILABLE`) if the billing store cannot be read.
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
- **Webhook destination guard** (SSRF): a webhook URL is attacker-chosen input this
  service then fetches from its own network position, so in production it may not point
  at a private, loopback, link-local (including the cloud metadata address
  `169.254.169.254`), CGNAT or multicast address — whether given as an IP literal or
  reached by DNS. Rejected at registration (`400 INVALID_ARGS`) **and** re-resolved before
  every send, because a hostname that resolved publicly when it was saved can be
  re-pointed afterwards; a delivery blocked there is marked `dead` immediately rather than
  retried. With `redirect: "manual"` in the worker this closes both the direct and the
  redirect-based route to internal services. A host that fails to resolve is deliberately
  *not* blocked — that is an ordinary transient the retry path already handles.
- **Provisioning CLIs**: `pnpm provision:tenant` and `pnpm provision:admin` for runtime
  create/revoke.
- **`scripts/migrate-db.sh`** — guarded one-time Postgres data migration
  (`preflight` → `dump` → `restore` → `verify`, each re-runnable). Because the schema is
  created idempotently at boot, repointing `DATABASE_URL` at an empty server silently
  produces a healthy-looking service with no tenants in it; the script moves the data
  first, refuses a non-empty target, never uses `pg_restore --clean`, and confirms the
  move by diffing per-table row counts. It does not touch `.env` — swapping the
  connection string stays a manual step taken after `verify` passes. Dumps land in
  `.dbdump/`, which is now gitignored as it holds credentials and tenant data.
- **Readiness probe**: `GET /readyz` checks Redis (`PING`), Postgres (`SELECT 1`) and blob
  storage, answering `503` with a per-dependency breakdown when either hard dependency is
  unreachable so the instance leaves rotation instead of accepting traffic it can only
  fail. Blob storage is reported but does not gate — it is optional, and reports healthy
  when switched off. `GET /healthz` stays dependency-free on purpose: a liveness probe that
  consults Redis restarts every pod into the same outage.
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
