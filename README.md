# Heirs OCR Service

Turn any document into structured, validated data through one uniform API. A caller
picks a **function** (parse this receipt, verify this ID, analyze this bank statement),
uploads a file, and gets back a typed JSON result. Any supported input — PDF, image,
DOCX, plain text — is normalized into one canonical markdown + layout representation,
then a per-function interpretation step runs on top of it.

The organizing principle: **extraction is shared, interpretation is per-function.**
Adding a capability means adding one folder under `src/functions/` and one registry line —
nothing else changes.

The repo ships three things:

- **The OCR API** — an Express service exposing the function catalog at `/v1/ocr/*`.
- **A multi-tenant SaaS layer** — Postgres-backed tenants + API keys, an admin console,
  a self-service tenant portal, and a subscription/billing model with plans, quotas,
  and entitlements.
- **A web frontend** — a Next.js app (`web/`) serving both the admin dashboard and the
  tenant portal.

## Documentation

The documentation set is four files. This README is the map; the other three go deep.

| Doc                                      | What's in it                                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[API_SPEC.md](./API_SPEC.md)**         | The external HTTP contract: endpoints, request/response envelopes, error codes, auth, entitlements. Source of truth for callers.                                              |
| **[TECHNICAL.md](./TECHNICAL.md)**       | Internal design: architecture, providers, GLM-OCR, tamper detection, billing model, observability, ops runbook, security/vendor threat model, governance, tech debt, roadmap. |
| **[CONTRIBUTION.md](./CONTRIBUTION.md)** | How to set up, build, test, and extend the service — and the conventions to follow.                                                                                           |
| [CHANGELOG.md](./CHANGELOG.md)           | Notable changes per release.                                                                                                                                                  |

## How it works

```
POST /v1/ocr/:function   (multipart: file + args)
      │
  auth → authorize → subscription → rate-limit → sensitivity → upload
      │
  1. Ingest     sniff magic bytes → sha256 → validate type against fn.accepts
  2. Extract    router → provider (GLM-OCR / Tesseract / pdf-parse / mammoth / plain-text) → RecognizedDocument
  3. Interpret  fn.execute(ctx, args)  → Azure OpenAI structured output (or deterministic)
  4. Validate   Zod result schema + business rules → typed result
```

Extraction is cached (keyed on the file's sha256) so the same document hitting two
functions pays for OCR once. Orchestration lives in one place —
[`src/pipeline.ts`](./src/pipeline.ts) — so the synchronous path and the async queue
worker run the identical code. Large or multi-page uploads route to a BullMQ queue
(`202 Accepted` + a `statusUrl`); everything else runs inline.

## Functions

Thirteen functions, discoverable at runtime via `GET /v1/ocr/functions` (which returns
JSON Schemas for args and result per function). The `Returns` column lists the top-level
keys of the `result` object; a worked example response for each function is in
[API_SPEC.md](API_SPEC.md#expected-responses). Keys marked `?` are omitted when they don't
apply — everything else is always present, `null` when the document doesn't carry it.

| Function                  | Does                                                  | LLM    | Sensitivity | Returns (top-level keys of `result`)                                                                                     |
| ------------------------- | ----------------------------------------------------- | ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `TEXT_EXTRACTION`         | Canonical markdown / plain text                       | no     | standard    | `text`, `format`, `pageCount`, `blocks?`                                                                                 |
| `DOCUMENT_CLASSIFICATION` | Label a document into a type                          | yes    | standard    | `label`, `confidence`, `alternatives`, `rationale`                                                                       |
| `RECEIPT_PARSING`         | Merchant, line items (itemized or single), totals     | yes    | standard    | `merchant`, `dateTime`, `lineItems`, `subtotal`, `tax`, `tip`, `total`, `confidence`, `warnings`                         |
| `FORM_DATA_EXTRACTION`    | Caller-defined fields (dynamic schema)                | yes    | standard    | `fields` — one key per requested field                                                                                   |
| `RESUME_PARSING`          | Contact, experience, education                        | yes    | standard    | `contact`, `summary`, `experience`, `education`, `certifications`, `professionalBodies`, `languages`, `skills`           |
| `ID_VERIFICATION`         | ID fields + MRZ, verified deterministically           | yes    | **pii**     | `documentType`, `fields`, `checks`, `assuranceLevel`                                                                     |
| `SIGNING`                 | Signature/seal detection + execution status           | vision | standard    | `fullyExecuted`, `blocks`, `unsignedBlocks`, `confidence`, `warnings`                                                    |
| `DOCUMENT_AUTHENTICITY`   | Doctored-vs-filled tamper signals (raw bytes)         | no     | standard    | `verdict`, `score`, `signals`, `analyzer`, `assuranceLevel`, `notes?`                                                    |
| `AUTO_EXTRACTION`         | Classify, then route to the matching parser           | yes    | **pii**     | `documentType`, `handler`, `classification`, `data`, `validation`                                                        |
| `BUDGET_ANALYSIS`         | Categorized budget line items + reconciliation        | yes    | standard    | `title`, `period`, `lineItems`, `totals`, `confidence`, `warnings`                                                       |
| `EXPENSE_CLAIM`           | Claimant, line items, totals, missing-receipt check   | yes    | standard    | `claimant`, `lineItems`, `subtotal`, `tax`, `total`, `confidence`, `warnings`                                            |
| `LOAN_REVIEW`             | Borrower financials + affordability recommendation    | yes    | **pii**     | `borrower`, `income`, `obligations`, `affordability`, `recommendation`, `riskFlags`, `summary`, `confidence`, `warnings` |
| `BANK_STATEMENT_ANALYSIS` | Transactions, balances, inflow/outflow reconciliation | yes    | **pii**     | `accountHolder`, `period`, `openingBalance`, `closingBalance`, `transactions`, `summary`, `confidence`, `warnings`       |

Deterministic post-validation (MRZ checksums, receipt/expense/budget totals,
bank-statement reconciliation, tamper heuristics) runs in code — the LLM extracts what
the document shows; verdicts are recomputed and never trust the model's arithmetic.

`RECEIPT_PARSING` takes `lineItemMode` (`"multiple"`, the default, or `"single"`) to control
whether an upload comes back itemized or collapsed to one line. The collapse runs *after*
reconciliation, so the `confidence` verdict still reflects the lines actually printed on the
receipt — see [API_SPEC.md](API_SPEC.md#receipt_parsing--itemized-or-single-line).

## The API in one screen

```
GET  /v1/ocr/functions        catalog + JSON Schemas (no auth)
POST /v1/ocr/:function         multipart: file + args (JSON string)
GET  /v1/ocr/jobs/:id          async job status + result
GET  /healthz  /readyz         liveness / readiness
GET  /metrics                  Prometheus scrape (bearer-guarded)
```

**Success**

```json
{
  "requestId": "req_01J...",
  "function": "RECEIPT_PARSING",
  "result": {},
  "meta": {
    "provider": "glm-ocr",
    "fellBackFrom": null,
    "pageCount": 1,
    "cached": false,
    "durationMs": 1830,
    "tokensUsed": 4210
  }
}
```

**Errors** — one envelope, typed codes, never a raw provider error:

```json
{ "error": { "code": "NO_TEXT_DETECTED", "message": "...", "requestId": "req_01J...", "retryable": false } }
```

Full contract — every code, status, and field — is in **[API_SPEC.md](./API_SPEC.md)**.

## Authentication

The OCR API is **server-to-server**: consuming apps call it from their **backend** with a
secret API key — never from browser JavaScript (which would expose the key).

```
Authorization: Bearer <api-key>        # or:  X-API-Key: <api-key>
```

Keys map to **tenants** held in Postgres. New keys use a readable
`hok_test_<uuid>` / `hok_live_<uuid>` prefix so operators can distinguish
environments, tenant-minted keys may carry an expiry date, and only the sha256 of
each key is stored, so a database dump can't be replayed as credentials.

Tenants and their keys are provisioned and revoked at runtime with no redeploy, from
the **admin console** (Tenants) or the **tenant portal** (API Keys). Either way the
raw key is shown **once** at creation — only its hash is stored, so a lost key is
replaced rather than recovered.

CORS is **default-closed** (backend callers ignore CORS; no browser origin is allowed
unless explicitly listed in `CORS_ALLOWED_ORIGINS` — the wildcard `*` is never used).
Set `AUTH_ENABLED=false` to bypass auth for local dev only (it throws at boot in prod).

## Subscriptions & multi-tenancy

Every tenant may carry a **subscription** to a **plan** (Free Trial, Pay-As-You-Go,
Starter, Business, Enterprise). The plan's entitlements — allowed functions, sensitivity
ceiling, per-minute rate, document quota, file/page caps, feature flags — are enforced
centrally by middleware and metered per processed document. A tenant with no subscription
is treated as unlimited (backward-compatible). See TECHNICAL.md § Billing & subscriptions.

Two operator surfaces, both served by the same Express app and by the Next.js frontend:

- **Admin console** (`/admin`, `/admin/api`) — manage tenants, admins, plans,
  subscriptions, and observe request counts, error rate, tokens, queue depth, and usage.
  Role-based: `owner` / `manager` / `viewer`. The first owner is seeded from env at
  startup.
- **Tenant portal** (`/tenant/api`) — a tenant's own users manage their API keys and
  team (`owner` / `member` roles), and run OCR in-app via a session cookie.

## Quickstart

This repo holds **two independent deployables**: the OCR service (backend, at the
repo root) and the frontend (`web/` — a self-contained pnpm workspace with an admin
console and a tenant portal). They build, run, and deploy separately.

```bash
# --- OCR service (backend) ---
pnpm install
cp .env.example .env       # then fill in Redis/Postgres URLs (+ Azure/GLM keys to enable those paths)
pnpm dev                   # API only (nodemon)
pnpm build && pnpm start   # production: tsc → node build/index.js
pnpm worker                # async queue worker: node build/worker.js
```

```bash
# --- Frontend apps (run separately) ---
cd web
pnpm install
pnpm dev                   # admin on :3000, tenant on :3001 (both apps)
pnpm build                 # builds apps/admin + apps/tenant
```

The apps proxy API calls to `OCR_API_URL` (see each app's `.env.local.example`).

Requires **Node 22+**, **pnpm**, a **Redis** instance (extraction cache + queue + rate
limiter + sessions), and a **Postgres** database (tenants, admins, usage, plans,
subscriptions). To enable the LLM/GLM paths, add Azure OpenAI and GLM-OCR credentials.
The Postgres schema is created idempotently at startup.

> `docker compose up --build` runs only the OCR service (`api` + `worker`) against your
> configured `REDIS_URL` / `DATABASE_URL`; add `--profile local-infra` for a throwaway
> Redis + Postgres. The apps have their own stack — `docker compose -f web/docker-compose.yml
up --build` (admin :3000, tenant :3001). See TECHNICAL.md § Operations for the topology.

> If `GLM_ENABLED=true`, a `GLM_API_KEY` is required or the service throws at startup.
> Likewise `AZURE_OPENAI_ENABLED=true` requires `AZURE_OPENAI_API_KEY`. Leave either flag
> `false` to run without that dependency.

## Configuration

Environment is Zod-validated at startup in [`src/config/env.ts`](./src/config/env.ts) — an
invalid config throws immediately. Copy [`.env.example`](./.env.example) and fill it in.

| Var                                                                                 | Default              | Purpose                                                      |
| ----------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------ |
| `PORT`                                                                              | `8080`               | HTTP port                                                    |
| `NODE_ENV`                                                                          | `development`        | `development` \| `production` \| `test`                      |
| `REDIS_URL`                                                                         | **required**         | Extraction cache + BullMQ + rate limiter + sessions          |
| `DATABASE_URL`                                                                      | **required**         | Postgres: tenants, admins, usage, plans, subscriptions       |
| `AUTH_ENABLED`                                                                      | `true`               | API-key auth; `false` bypasses (local dev only)              |
| `API_KEY_CACHE_TTL_SECONDS`                                                         | `30`                 | In-memory TTL for validated keys                             |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD`                                | —                    | Seeds the first admin owner at startup                       |
| `ADMIN_SESSION_TTL_SECONDS` / `TENANT_SESSION_TTL_SECONDS`                          | `28800` (8h)         | Admin / tenant portal session lifetime                       |
| `CORS_ALLOWED_ORIGINS`                                                              | `` (closed)          | Comma-separated browser origins; empty = no CORS             |
| `RATE_LIMIT_ENABLED` / `_MAX` / `_WINDOW_SECONDS`                                   | `true` / `60` / `60` | Per-tenant rate limiting (fails open if Redis down)          |
| `MAX_FILE_SIZE_BYTES`                                                               | 50 MiB               | Upload cap                                                   |
| `ASYNC_PAGE_THRESHOLD` / `ASYNC_SIZE_THRESHOLD_BYTES`                               | `5` / 5 MiB          | Above either → job goes async                                |
| `EXTRACTION_CACHE_TTL_SECONDS`                                                      | 7 days               | Extraction cache TTL                                         |
| `METRICS_AUTH_TOKEN`                                                                | unset                | Bearer token for `/metrics`; unset = open (private net only) |
| `LLM_COST_NGN_PER_1K_TOKENS` / `LOW_CONFIDENCE_THRESHOLD`                           | `0` / `0.7`          | Cost + quality SLI knobs                                     |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                                       | unset                | Set → traces ship over OTLP/HTTP                             |
| `AZURE_OPENAI_ENABLED` (+ `_API_KEY`/`_ENDPOINT`/`_API_VERSION`/`_DEPLOYMENT_NAME`) | `false`              | Interpretation layer master switch                           |
| `GLM_ENABLED` (+ `_API_KEY`)                                                        | `false`              | GLM-OCR master switch                                        |
| `GLM_BASE_URL` / `GLM_MAX_PAGES` / `GLM_CONCURRENCY`                                | z.ai / `30` / `8`    | GLM endpoint (swap for PII/self-host), chunk + concurrency   |

> **Repointing `DATABASE_URL` does not move your data.** The schema is created idempotently at
> boot, so an empty server comes up looking perfectly healthy — with no tenants in it. Migrate
> first with `scripts/migrate-db.sh`, then swap the string:
> [TECHNICAL § Moving the database](./TECHNICAL.md#moving-the-database-scriptsmigrate-dbsh).

## Project layout

```
src/
  config/         env (Zod) + provider policy + CORS
  auth/           Postgres-backed tenants / API keys + admins + tenant-users + sessions + login throttle
  billing/        plans, subscriptions, entitlements (pure decisions), plan store
  ingest/         multer upload + magic-byte sniff + sha256
  providers/      OcrProvider implementations (glm/ tesseract pdf-text mammoth plain-text) + router
  functions/      one folder per function: args, result, prompt, execute + registry
  authenticity/   deterministic tamper analysis (PDF + image)
  llm/            Azure OpenAI structured-output wrapper; Zod → JSON Schema
  http/           routes (ocr, admin, tenant), error envelope, middleware
  jobs/           BullMQ queue + worker for async requests
  observability/  logger (redaction), metrics, tracing, usage
  scripts/        provision-admin CLI (admin lockout recovery only)
scripts/          deploy + one-time Postgres data migration (migrate-db.sh)
web/              Next.js frontend (admin dashboard + tenant portal)
```

See **[TECHNICAL.md](./TECHNICAL.md)** for the full design and **[CONTRIBUTION.md](./CONTRIBUTION.md)**
to start hacking.

## License

UNLICENSED — © Heirs. Internal use.
