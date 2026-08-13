# Heirs OCR — Technical Reference

The internal design reference: how a request flows, what the layers are, how the SaaS layer
works, how to operate it, and the governance behind the build. For the external contract see
[API_SPEC.md](./API_SPEC.md); to start hacking see [CONTRIBUTION.md](./CONTRIBUTION.md).

## Contents

1. [Architecture](#1-architecture)
2. [Engineering principles](#2-engineering-principles)
3. [Providers & GLM-OCR](#3-providers--glm-ocr)
4. [Tamper detection (`DOCUMENT_AUTHENTICITY`)](#4-tamper-detection-document_authenticity)
5. [Billing & subscriptions](#5-billing--subscriptions)
6. [Multi-tenancy, admin console & tenant portal](#6-multi-tenancy-admin-console--tenant-portal)
7. [Web frontend](#7-web-frontend)
8. [Observability & operations](#8-observability--operations)
9. [Security & vendor threat model](#9-security--vendor-threat-model)
10. [Governance: decisions, ownership & cost](#10-governance-decisions-ownership--cost)
11. [Technical debt register](#11-technical-debt-register)
12. [Roadmap: expansion use cases](#12-roadmap-expansion-use-cases)

---

## 1. Architecture

### Organizing principle

> **Extraction is shared, interpretation is per-function.**

A caller picks a _function_ (e.g. `RECEIPT_PARSING`), uploads a file, and passes
function-specific args. Any supported input is normalized into one canonical
`RecognizedDocument` (markdown + layout blocks), then the function's `execute` step
interprets it. Adding a new function is additive: one folder under `src/functions/`, one line
in the registry.

### Request pipeline

```
POST /v1/ocr/:function   (file + args)
      │
  auth → authorize → requireSubscription → rate-limit → sensitivity → upload
      │
      ▼
  1. Ingest     multipart → sniff magic bytes → sha256 → validate against fn.accepts
  2. Extract    router picks provider by capability → recognize (with fallback) → cache
  3. Interpret  fn.execute(ctx, args)  ── Azure OpenAI structured output (per function)
  4. Validate   Zod result schema + business rules → typed result
```

Orchestration lives in one place — [`src/pipeline.ts`](./src/pipeline.ts) — so the sync path
and the async queue worker run the _identical_ code.

### Layers

| Layer          | Directory                 | Responsibility                                                              |
| -------------- | ------------------------- | --------------------------------------------------------------------------- |
| Ingestion      | `src/ingest/`             | `multer` memory upload + size cap; `file-type` magic-byte sniff; sha256     |
| Extraction     | `src/providers/`          | Each provider emits the same `RecognizedDocument` shape                     |
| Routing        | `src/providers/router.ts` | Match a function's required capabilities to a provider + fallback chain     |
| Interpretation | `src/functions/*/`        | Per-function args/result schemas, prompt, and `execute`                     |
| Authenticity   | `src/authenticity/`       | Deterministic tamper analysis on raw bytes (PDF + image)                    |
| LLM            | `src/llm/`                | Azure OpenAI structured-output wrapper; Zod → JSON Schema                   |
| Billing        | `src/billing/`            | Plans, subscriptions, pure entitlement/pricing decisions                    |
| HTTP           | `src/http/`               | Routes (ocr / admin / tenant), error envelope, middleware                   |
| Jobs           | `src/jobs/`               | BullMQ queue + worker for async (large/multi-page) requests                 |
| Observability  | `src/observability/`      | Logger (with redaction), metrics, tracing, usage                            |
| Persistence    | `src/db.ts`, `src/auth/`  | Postgres registries (tenants, admins, tenant-users); Redis (`src/redis.ts`) |

### The load-bearing type

Every provider returns this. It is the single contract the whole interpretation layer is
written against ([`src/providers/types.ts`](./src/providers/types.ts)):

```ts
type RecognizedDocument = {
  markdown: string; // canonical format — one prompt shape regardless of source
  plainText: string;
  pages: PageResult[];
  blocks: LayoutBlock[]; // normalized 0–1 bboxes; [] for text-only providers
  pageCount: number;
  provider: string;
  fellBackFrom?: string;
  tokensUsed?: number;
  durationMs: number;
};
```

### Function registry

Functions are declared with `defineOcrFunction` and collected in
[`src/functions/registry.ts`](./src/functions/registry.ts). `GET /v1/ocr/functions` walks the
registry and returns JSON Schema for args and result per function. The thirteen functions and
their metadata:

| Function                  | LLM step             | Requires             | Sensitivity |
| ------------------------- | -------------------- | -------------------- | ----------- |
| `TEXT_EXTRACTION`         | no                   | `text`               | standard    |
| `DOCUMENT_CLASSIFICATION` | yes                  | `text`               | standard    |
| `RECEIPT_PARSING`         | yes                  | `text`, `tables`     | standard    |
| `FORM_DATA_EXTRACTION`    | yes (dynamic schema) | `text`               | standard    |
| `RESUME_PARSING`          | yes                  | `text`               | standard    |
| `ID_VERIFICATION`         | yes + MRZ            | `text`               | **pii**     |
| `SIGNING`                 | vision               | `layout`, `seals`    | standard    |
| `DOCUMENT_AUTHENTICITY`   | no (raw bytes)       | — (`skipExtraction`) | standard    |
| `AUTO_EXTRACTION`         | yes (classify+route) | `text`               | **pii**     |
| `BUDGET_ANALYSIS`         | yes                  | `text`               | standard    |
| `EXPENSE_CLAIM`           | yes                  | `text`               | standard    |
| `LOAN_REVIEW`             | yes                  | `text`               | **pii**     |
| `BANK_STATEMENT_ANALYSIS` | yes                  | `text`               | **pii**     |

`sensitivity: "pii"` is declarative and drives middleware centrally, where it can't be
bypassed per call site: no raw text in logs (`createRedactingLogger`), no trace body capture,
`Cache-Control: no-store`, no extraction caching, and no async queueing.

`AUTO_EXTRACTION` is the routing meta-function: it classifies the upload against the supported
catalog and dispatches to the matching parser (`classify → extract`). It declares `pii` because
a detected bank/tax/payslip/medical document must be handled under PII rules.

### Adding a function

1. Create `src/functions/<name>/` with `args.ts` (Zod), `result.ts` (Zod), and `execute.ts`;
   add a `prompt.ts` if it uses the LLM, and a `validate.ts` for deterministic post-checks.
2. Declare it with `defineOcrFunction`, setting `accepts`, `requires` (capabilities),
   `sensitivity`, `maxPages`, and optionally `confidenceOf` (feeds the quality SLI).
3. Register it in `src/functions/registry.ts`. The catalog, JSON Schemas, routing, and the
   pipeline pick it up with no further changes.

### Wiring status

The catalog, schemas, router, pipeline, HTTP layer, security middleware, billing/entitlements,
**and both the sync and async paths** are wired end-to-end. No integration seam is stubbed.

- **GLM-OCR provider is wired**, not stubbed — client (bounded retry/backoff), PDF-page
  chunker, and response mapper, constructed behind `GLM_ENABLED`. When off it's absent from the
  registry and the router falls image/scanned-PDF chains back to Tesseract. Covered by
  `test/glm.test.ts`. **Caveat:** those tests exercise our code against the documented
  `layout_parsing` contract; the provider has not been validated against z.ai's live API — do a
  smoke test with a real key before it carries production traffic, and see
  [§ 9](#9-security--vendor-threat-model) before any `pii` document routes to it.
- **Async queue + worker are wired** — a `standard` request over the size/page thresholds routes
  to BullMQ (`202` + `statusUrl`); the worker runs the identical `runPipeline` off-request and
  `GET /v1/ocr/jobs/:id` reports tenant-scoped status/result. Typed `OcrError` codes survive the
  queue boundary; `pii`/`restricted` files are never enqueued. Covered by `test/jobs.test.ts`.
- **Observability is wired** — real `prom-client` series at `/metrics`, real OpenTelemetry
  tracing (OTLP/HTTP export gated on `OTEL_EXPORTER_OTLP_ENDPOINT`). Per-request metrics cover
  `success` and `error`. `recordConfidence` and the `ocr_estimated_cost_ngn` counter are fed
  from the pipeline (`confidenceOf` + `quoteDocument`).
- **LLM functions** run against `AzureLlmClient` only when `AZURE_OPENAI_ENABLED=true` and the
  deployment is configured; otherwise `complete` throws a clear config error (surfaced as
  `INTERPRETATION_FAILED`). `TEXT_EXTRACTION` and `DOCUMENT_AUTHENTICITY` need no LLM.

---

## 2. Engineering principles

What the service optimises for, so decisions can be checked against it rather than re-argued.

1. **Extraction is shared; interpretation is per-function.** One canonical `RecognizedDocument`
   feeds every function. A new capability is a folder + a registry line — never a new pipeline.
2. **Determinism over LLM where math suffices.** MRZ checksums, receipt/expense/budget totals,
   bank-statement reconciliation, tamper signals — computed in code. The LLM extracts what the
   document shows; verdicts are recomputed deterministically and never trust the model's arithmetic.
3. **Fail closed on security, fail open on availability.** Auth and the tenant registry reject
   when their store is unreachable. Rate limiting and billing degrade toward serving.
4. **Sensitivity is declarative and centrally enforced.** `sensitivity: "pii"` drives no-store,
   redacted logs, no trace-body capture, no caching, and no queueing — in one place (the
   pipeline), not per call site.
5. **Config in the environment, validated at boot.** All config from env, Zod-validated;
   invalid config throws. No secrets in source. Enabling a vendor without its key fails fast.
6. **Additive, versioned contracts.** The `/v1/` prefix, the typed error envelope, and the
   self-describing catalog are the compatibility surface. Any change to error codes or the
   response envelope is a versioned change.
7. **Decisions decide; middleware does I/O.** Pure functions (entitlements, pricing, MRZ,
   reconciliation) take explicit inputs and are unit-tested without Express or a database;
   middleware maps their decisions to HTTP.
8. **Debt is named and ticketed, not silent** — see [§ 11](#11-technical-debt-register).

---

## 3. Providers & GLM-OCR

### Providers

| Provider                      | Accepts                  | Capabilities                                       | File                      |
| ----------------------------- | ------------------------ | -------------------------------------------------- | ------------------------- |
| `PlainTextProvider`           | text                     | `text`                                             | `providers/plain-text.ts` |
| `PdfTextProvider` (pdf-parse) | pdf                      | `text`                                             | `providers/pdf-text.ts`   |
| `MammothProvider`             | docx                     | `text`, `tables`                                   | `providers/mammoth.ts`    |
| `TesseractProvider`           | image (+ rasterized pdf) | `text`, `layout`                                   | `providers/tesseract.ts`  |
| `GlmOcrProvider`              | pdf, image               | `text`, `layout`, `tables`, `handwriting`, `seals` | `providers/glm/`          |

Routing rules (`router.ts`, `config/providers.ts`):

- **DOCX** → mammoth, always.
- **PDF, text-only need** → pdf-parse first, then a per-page scanned heuristic
  (`< ~100 chars/page` ⇒ re-route that page to OCR).
- **PDF needing `layout`/`seals`** → straight to GLM-OCR.
- **Image** → GLM-OCR, fall back to Tesseract on error/timeout.

Fallback chains are config (`defaultProviderPolicy`), with per-function overrides.

### Why GLM-OCR

GLM-OCR is the **layout-aware extraction layer** — it turns images and scanned PDFs into
markdown + positioned layout blocks. It does **not** interpret; Azure OpenAI does that.

- **Seal/stamp recognition is its standout capability.** For Nigerian corporate documents —
  company seals, stamped receipts, stamped affidavits — this is the single biggest reason to
  adopt it over Tesseract. It also leads on handwriting and real-world tables.
- Roughly an order of magnitude cheaper than traditional OCR. **Cost is not the constraint;
  latency and page limits are.**

### API contract

- **Endpoint:** `POST {GLM_BASE_URL}/layout_parsing`. Default
  `GLM_BASE_URL=https://api.z.ai/api/paas/v4` (international; use from Lagos). Mainland host is
  `https://open.bigmodel.cn/api/paas/v4`.
- **Auth:** `Authorization: Bearer ${GLM_API_KEY}`. **Not multipart** — `file` is a URL or a
  base64 data URI.
- **Response:** `md_results` is the page markdown; `layout_details` is an array-per-page of
  blocks (`{ index, label, bbox_2d, content, height, width }`, bbox normalized 0–1; table
  blocks carry HTML in `content`).

> ⚠️ **There is no `prompt` parameter on the hosted `layout_parsing` API.** The promptable/KIE
> mode only exists on the self-hosted model and the Ollama build. GLM-OCR is extraction-only.

**Limits (verify against key):** single image ≤ 10 MB; PDF ≤ 50 MB; pages/call — docs
disagree (z.ai says 30, bigmodel says 100), so design for 30 (`GLM_MAX_PAGES`, default 30) and
chunk.

### Provider structure (`src/providers/glm/`)

| File         | Responsibility                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.ts`  | `layoutParsing()` — `fetch` with auth header, bounded retry/backoff on 429 + 5xx, `AbortSignal` timeout                                                     |
| `chunker.ts` | `splitPdfToPageImages()` renders each PDF page to a base64 PNG; `mapWithConcurrency()` runs `p-limit`-bounded parallel calls (`GLM_CONCURRENCY`, default 8) |
| `mapper.ts`  | `mapLayoutParsing()` flattens `layout_details[page][block]` → `LayoutBlock[]`, offsetting page indices, builds `pages` + `markdown`                         |
| `index.ts`   | `GlmOcrProvider.recognize()` — chunk → parallel `client.layoutParsing` → `mapLayoutParsing`                                                                 |

**Prefer base64 data URIs over URLs**: no blob-store exposure (the doc stays in the request
body), sidesteps the 50 MB PDF cap (each page image is under 10 MB), and sidesteps the page
limit (page-splitting is already the chunking strategy). Benchmarks favour images over file
upload and parallel page calls over serial PDF processing.

### Updating the integration safely

1. **Roll out in shadow mode first** — on a sampled % of image/scanned-PDF requests, run both
   GLM and Tesseract, serve Tesseract, log both and their diff. OCR quality is
   workload-specific; benchmarks aren't your Nigerian receipts and stamped forms.
2. **Pin and re-verify the limits** (`GLM_MAX_PAGES`) against your own key.
3. **Keep the mapper defensive** — an unknown `label` maps to a safe default (treat as `image`
   for geometry, keep `content`), never throws. A response-shape change should degrade, not 500.
4. **Watch `ocr_provider_fallback_total{from="glm-ocr"}`** — a rising GLM→Tesseract fallback rate
   is the early warning that the upstream is degrading (invisible in success rate because
   fallback _works_).
5. **Feature-flag it** — `GLM_ENABLED` gates the provider; a bad rollout is one env flip to revert.

### Data residency (read before a PII function routes to GLM)

The hosted API is operated by Zhipu AI in China. Sending Nigerian NINs, passports, and driver's
licences there is a **cross-border personal-data transfer** under the Nigeria Data Protection
Act 2023 and needs a documented lawful basis. Options, in order of preference:

1. **Self-host GLM-OCR for `pii`/`restricted` functions** (MIT-licensed, runs on a single
   4 GB-VRAM GPU). The provider stays one implementation with a swapped `GLM_BASE_URL`. Cleanest
   and intended answer.
2. Use Azure OpenAI vision for PII functions; reserve hosted GLM for non-PII.
3. Hosted GLM with a documented transfer basis + consent capture (legal dependency).

Today no `pii` function requires `layout`/`seals`, so **no raw PII reaches GLM** — see [§ 9](#9-security--vendor-threat-model).

---

## 4. Tamper detection (`DOCUMENT_AUTHENTICITY`)

The `DOCUMENT_AUTHENTICITY` function tells a _legitimately filled_ document apart from a
_doctored_ one. It runs on the **raw bytes** with no OCR/LLM pass (`skipExtraction: true`) and
returns `TamperSignals`.

- **Filled** — a form completed the way it was designed to be: AcroForm/XFA field values
  entered, a signature added to a signature field, a flatten/print-to-PDF. The base content is
  untouched; only the intended blanks changed.
- **Doctored** — content the document was **not** meant to expose to editing was altered: an
  amount painted over and retyped, a name spliced in, a date changed, a stamp copy-pasted, a page
  swapped, an image region cloned.

The distinction is not "was it modified" — almost every real PDF was — but **"were the
modifications confined to the intended, legitimate editing surface?"**

> ⚠️ **Scope honesty.** This is _heuristic authenticity signalling_, not forensic proof. A
> competent forger who rebuilds and re-flattens the file can defeat every signal here. The
> result carries `assuranceLevel: "heuristic-only"` — never report a naked "authentic: true".

### Where it fits

Tamper analysis is a **cross-cutting signal**, not one more interpretation function. It runs on
the raw buffer because the evidence lives in container structure — the PDF object graph, the JPEG
quantization tables — which the canonical `RecognizedDocument` deliberately throws away.

```
src/authenticity/
  signals.ts    TamperSignals type + noisy-OR score/verdict aggregation
  pdf.ts        PDF structural analysis (pdf-lib + raw byte scan)
  image.ts      image editor fingerprints, XMP history, EXIF checks
  index.ts      dispatch by mime group
```

### Result type

```ts
type TamperVerdict = "clean" | "suspicious" | "likely-doctored" | "inconclusive";
type TamperSignals = {
  verdict: TamperVerdict;
  score: number; // aggregated 0–1 suspicion — calibrate on a golden corpus
  signals: { code: string; severity: "info" | "low" | "medium" | "high"; detail: string }[];
  assuranceLevel: "heuristic-only";
  analyzer: "pdf" | "image" | "unsupported";
  notes?: string[]; // what was NOT checked, so `clean` is never a full pass
};
```

Aggregation: any `high` signal ⇒ at least `suspicious`; corroborating `medium` signals push to
`likely-doctored`. Absence of signals is `clean` **but never "authentic"** — `notes[]` records
which checks did not run.

### What it checks

**PDF:** incremental-update / revision analysis (`%%EOF` marker counting); digital-signature
integrity (`/ByteRange` — bytes appended _after_ a signed range flagged `high`); metadata /
producer consistency (`CreationDate` vs `ModDate`, `/Producer`/`/Creator` mismatch).

**Image:** editor fingerprints (Software/XMP naming Photoshop/GIMP/phone editors); XMP edit
history; stripped-EXIF detection on JPEG.

| Observation             | Filled (benign)                                | Doctored (flag)                                 |
| ----------------------- | ---------------------------------------------- | ----------------------------------------------- |
| PDF incremental updates | touch `/AcroForm` field values + `/AP` streams | rewrite `/Contents`, `/Page`, splice `/XObject` |
| Digital signature       | none, or covers final bytes                    | edits **after** `/ByteRange`                    |
| Metadata / producer     | consistent authoring pipeline                  | edited by a different tool after creation       |
| Image EXIF / software   | consistent, no editor software                 | Photoshop/GIMP; stripped EXIF                   |

### Deferred (deliberately not faked)

Deep image forensics (ELA, double-JPEG, PRNU, copy-move) and object-level PDF revision diffing
need heavier deps and a calibrated corpus. Keep any deep tier behind a flag so the default path
stays light, and **calibrate thresholds on a golden corpus** of known-filled Nigerian forms and
known-doctored variants — false positives on legitimately-filled forms erode trust fastest.

`SIGNING` and `ID_VERIFICATION` are the natural consumers — a "fully executed" verdict on a
doctored document is worse than useless. Keep the honest framing: tamper heuristics _narrow_
suspicion, they don't establish identity.

---

## 5. Billing & subscriptions

A **plan** is the catalog product (its price, limits, and what it unlocks); a **subscription**
is one tenant's live enrolment. Decisions are never made off raw fields at a call site — the
pure guards in `src/billing/entitlements.ts` read the domain model
(`src/types/subscription.ts`) so the same rules apply in auth, rate-limiting, the pipeline, and
the admin console.

### Model

- **Money** is always integer **minor units** (kobo/cents) — never a float — and formatted at
  the edge.
- **Billing kinds** (discriminated union): `trial` (free, time/quota-bounded), `per_document`
  (metered pay-as-you-go with optional per-page surcharge + minimum charge), and `monthly`
  (flat fee + included allowance + optional overage price).
- **Entitlements**: `allowedFunctions` (empty = all), `maxSensitivity` ceiling, boolean
  `features`, and hard `limits` (documents/period, pages/doc, file size, rate/min, concurrent
  jobs, retention days). `null` on a limit means "no plan-imposed limit" (env caps still apply).
- **A subscription snapshots the plan** it was created under, so editing a plan re-prices only
  _new_ enrolments.
- **Trial window** resolves a plan's `TrialPolicy` to concrete dates + allowances once, on the
  record. A trial's own page/size caps fold in tighter-wins over the plan's.

### Lifecycle

```
trialing → active → (past_due ⇄ active) → canceled/expired
                 ↘ suspended (operator hold, any state)
```

`effectiveStatus` resolves the truth on read (a stored `trialing` row whose window has elapsed
reads as `active` if a payment method is on file, else `expired`). `isServable` serves
`trialing`/`active`/`past_due` — `past_due` is deliberately still served (dunning grace),
matching the fail-open availability stance.

### Default plan catalog (`src/billing/plans.ts`)

Prices are **placeholder seed data** — the code-defined catalog seeds the durable `plans` table
at boot, after which the DB is the source of truth and admins edit plans via the Admin API.

| Plan          | Tier         | Billing                                   | Functions / ceiling                                                                                | Notable limits                        |
| ------------- | ------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Free Trial    | `trial`      | Free, 14 days / 50 docs                   | Standard functions, `standard` ceiling                                                             | 10 pages, 10 MB, 10 req/min, no async |
| Pay As You Go | `payg`       | ₦25/doc + ₦5/page, ₦25 min                | Standard functions, `standard`                                                                     | 30 pages, 30 req/min, 2 concurrent    |
| Starter       | `starter`    | ₦25,000/mo, 2,000 docs incl., ₦15 overage | Standard functions, `standard`; async                                                              | 50 pages, 60 req/min, 5 concurrent    |
| Business      | `business`   | ₦120,000/mo, 15,000 docs, ₦10 overage     | + PII (`ID_VERIFICATION`, `SIGNING`, `LOAN_REVIEW`, `BANK_STATEMENT_ANALYSIS`); webhooks, priority | 100 pages, 120 req/min, 20 concurrent |
| Enterprise    | `enterprise` | Custom, invoiced (hidden from self-serve) | All functions, `restricted` ceiling                                                                | Negotiated                            |

### Enforcement & metering

- `requireSubscription` middleware gates each `/v1/ocr/:function` call: `requireActive` →
  `canUseFunction` (function + sensitivity ceiling) → `checkDocumentQuota`, and publishes the
  plan's `rateLimitPerMinute` onto the rate limiter. A denial maps to the HTTP layer:
  `SUBSCRIPTION_INACTIVE`→402, `NOT_ENTITLED`/`SENSITIVITY_BLOCKED`→403, `QUOTA_EXCEEDED`→429.
- **No subscription = unlimited** (backward-compatible) — only an explicit subscription gates.
- `quoteDocument` prices a processed document under the current model (trial coverage and
  within-allowance monthly documents are free). `recordDocumentUsage` meters period usage +
  charge + trial burn-down after each document; the inline path meters on completion, the worker
  meters async jobs.

---

## 6. Multi-tenancy, admin console & tenant portal

Durable identity lives in Postgres (`src/db.ts`, `src/auth/`); ephemeral session/rate state
lives in Redis.

- **Tenants & API keys** (`src/auth/tenants.ts`) — a tenant is keyed by the sha256 of its API
  key; a record carries `allowedFunctions`, `rateLimit`, `allowedOrigins`, and a `disabled`
  flag. Keys are provisioned/revoked at runtime (CLI, admin console, or tenant portal).
- **Admin users** (`src/auth/admins.ts`) — platform operators with roles `owner` > `manager` >
  `viewer`, passwords hashed with argon2id, sessions in Redis (`admin-session.ts`). The first
  owner is seeded from `ADMIN_BOOTSTRAP_EMAIL`/`_PASSWORD` at startup (idempotent — never
  overwrites a changed password or deleted account).
- **Tenant users** (`src/auth/tenant-users.ts`) — a tenant org's own members, roles `owner` /
  `member`, argon2id passwords, sessions in Redis (`tenant-session.ts`). The tenant session
  cookie also authenticates in-app OCR at `/v1/ocr/*` (the OCR auth middleware reads it when no
  API key is present).
- **Login throttle** (`src/auth/login-throttle.ts`) — per-surface brute-force throttle so the
  tenant surface can't lock out admins and vice versa.

**Admin console** (`/admin` static assets + `/admin/api` JSON) — tenant CRUD, admin management,
plan catalog, subscription assignment, and observability (metrics summary, usage, queue, health).
Role-gated. Inert until an admin exists.

**Tenant portal** (`/tenant/api` JSON) — a tenant's owners manage API keys and team members and
run OCR in-app. Every route is scoped to the caller's own org. See API_SPEC Appendices A & B for
the full route tables.

---

## 7. Web frontend

`web/` is a **self-contained pnpm workspace** (its own lockfile, separate from the backend),
holding **two independent Next.js apps** and their shared code — so the two operator surfaces
deploy to **different origins** with no shared bundle:

```
web/
├─ apps/admin   (@heirs/admin)   → admin.example.com   (/analytics, /tenants, /users,
│                                   /subscriptions, /system-health, …; login /admin/login)
├─ apps/tenant  (@heirs/tenant)  → app.example.com     (/ocr, /keys, /team; login /login)
└─ packages/
   ├─ ui          (@heirs/ui)          shadcn/Base-UI primitives + shared components + styles
   └─ api-client  (@heirs/api-client)  the axios http client
```

Each app has its **own** `proxy.ts` (Next 16 Proxy, formerly Middleware) — an **optimistic**
gate that only checks its cookie's presence (`admin_session` / `tenant_session`); real validation
happens in the backend on every proxied call. Each app's server-side routes under
`src/app/api/*` proxy to the backend (`OCR_API_URL`), attaching the API key server-side so it
never reaches the browser (`.env.local.example` per app). The shared packages are consumed as
source via `transpilePackages`; `output: "standalone"` with `outputFileTracingRoot` at the
workspace root. Stack: React Query, React Hook Form + Zod, Base UI, Tailwind v4.

The frontend builds/deploys **separately** from the OCR service: its own CI (`web-ci.yaml`),
its own `web/docker-compose.yml` (admin :3000, tenant :3001) and per-app Dockerfiles. The
backend's `docker-compose.yml` runs only api + worker.

> `web/AGENTS.md` is auto-generated by `next dev` and warns that this Next.js version has
> breaking changes vs. training data — read `node_modules/next/dist/docs/` before writing web code.

---

## 8. Observability & operations

### Topology

Two process types off **one image**, plus Redis and Postgres. Both processes are stateless;
**durable** state (tenants, admins, tenant-users, usage, plans, subscriptions) lives in Postgres,
**ephemeral** state (extraction cache, job queue, rate-limit counters, sessions) lives in Redis.

| Process    | Command                 | Scales on         | Purpose                                 |
| ---------- | ----------------------- | ----------------- | --------------------------------------- |
| `web`      | `node build/index.js`   | request rate      | HTTP API; runs the sync pipeline inline |
| `worker`   | `node build/worker.js`  | async job backlog | Drains the BullMQ queue off-request     |
| `redis`    | managed / `redis:7`     | —                 | Cache + queue + rate-limit + sessions   |
| `postgres` | managed / `postgres:16` | —                 | System of record                        |

`docker compose up --build` runs `api` + `worker` + `web` against the `REDIS_URL` /
`DATABASE_URL` in `.env` (managed services by default). Add `--profile local-infra` to also
start a throwaway Redis + Postgres and point those URLs at the in-network `redis` / `postgres`
hosts.

### Configuration

All config is env, Zod-validated at boot ([`src/config/env.ts`](./src/config/env.ts)) —
**invalid config throws on startup, so a bad deploy fails fast rather than half-running.** The
full variable list is in [README § Configuration](./README.md#configuration) and `.env.example`.
Production refinements: `AUTH_ENABLED` and `RATE_LIMIT_ENABLED` must be `true`, and enabling a
vendor without its key throws.

### Health, probes & scrape endpoints

| Endpoint       | Auth                               | Use                                                                           |
| -------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| `GET /healthz` | none                               | Liveness — process is up.                                                     |
| `GET /readyz`  | none                               | Readiness. **⚠️ Currently a static `ok`** — does not yet probe Redis/vendors. |
| `GET /metrics` | bearer if `METRICS_AUTH_TOKEN` set | Prometheus scrape. No tenant data in labels — keep on an internal net.        |

### Key metrics & suggested alerts

Series live in [`src/observability/metrics.ts`](./src/observability/metrics.ts).

| Signal                      | Series                                                                           | Alert when                                      |
| --------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------- |
| Error rate                  | `ocr_requests_total{outcome="error"}` / total                                    | > 5% over 5m                                    |
| Provider fallbacks          | `ocr_provider_fallback_total`                                                    | Sustained rise ⇒ a primary provider is degraded |
| Extract / interpret latency | `ocr_extract_duration_ms`, `ocr_interpret_duration_ms` (success-only histograms) | p95 breaches SLO                                |
| LLM spend                   | `ocr_tokens_used_total`, `ocr_estimated_cost_ngn_total`                          | Unexpected spike ⇒ runaway usage/abuse          |
| Quality                     | `ocr_low_confidence_ratio` (from `confidenceOf` + `LOW_CONFIDENCE_THRESHOLD`)    | Sustained rise ⇒ extraction quality dip         |
| Job backlog                 | BullMQ `waiting` depth (Redis)                                                   | Grows unbounded ⇒ worker stalled/down           |

Latency histograms observe **successful** requests only, so a latency graph isn't skewed by fast
failures.

### Common failures → remediation

Every failure is a typed code ([`src/http/errors.ts`](./src/http/errors.ts)); map the code to the
cause:

| Code (HTTP)                                        | Likely cause                                                                     | Action                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `INTERPRETATION_FAILED` (502)                      | Azure down/misconfigured, or `AZURE_OPENAI_ENABLED=false` on an LLM function     | Check Azure status + config + deployment name. Non-LLM functions unaffected. |
| `EXTRACTION_FAILED` (502)                          | Every provider in the chain failed (corrupt file; GLM + Tesseract both erroring) | Check provider health / fallback metric; retry; inspect input.               |
| `PROVIDER_UNAVAILABLE` (503)                       | Enqueue failed → Redis unreachable, or a provider timed out                      | Check Redis connectivity first. Retryable.                                   |
| `RATE_LIMITED` / `QUOTA_EXCEEDED` (429)            | Tenant over its window / plan allowance                                          | Expected; raise `--rate` or upgrade the plan if legitimate.                  |
| `PAYMENT_REQUIRED` (402)                           | Subscription expired/canceled/suspended                                          | Reactivate or add a payment method (admin console).                          |
| `UNAUTHORIZED` / `FORBIDDEN` (401/403)             | Bad/revoked key, or key/plan not scoped to the function                          | Verify with `provision:tenant list`; re-provision if needed.                 |
| `PAGE_LIMIT_EXCEEDED` / `FILE_TOO_LARGE` (422/413) | Input exceeds `maxPages` / size cap                                              | Caller-side; adjust limits only deliberately.                                |

**Redis down** — cache/queue/rate-limit/sessions affected: `PROVIDER_UNAVAILABLE` on enqueue,
admin/tenant logins fail (sessions unreadable), rate-limit and extraction cache **fail open**.
Restore Redis; processes reconnect without a redeploy.

**Postgres down** — system of record: `UNAUTHORIZED` once the tenant cache goes cold (tenant
resolution **fails closed**), admin/portal reads fail, usage counters stall (usage writes are
fire-and-forget and swallow errors). Restore Postgres; processes reconnect.

**Worker stalled** — `waiting` depth climbs. Check the worker is up and logging `job completed`
and its Redis connection. Restart (`node build/worker.js`); BullMQ redelivers in-flight jobs; a
failed job keeps a typed code recoverable via `GET /v1/ocr/jobs/:id`.

### Deploy, shutdown, rollback

- **Graceful shutdown (both entrypoints):** on `SIGTERM`/`SIGINT` the web server stops accepting
  connections, drains in-flight requests, flushes traces, and closes the Postgres pool and Redis,
  with a **10s forced-exit fallback**. The worker drains active jobs. Rolling deploys don't cut
  in-flight work.
- **Rollback:** processes are stateless and config-driven. The schema is applied additively at
  boot (`CREATE TABLE IF NOT EXISTS`, no destructive migrations), so redeploying the prior image
  is safe and loses no durable Postgres data. Re-check that any changed env var is reverted too.

### Tenant management (CLI)

```
pnpm provision:tenant create <tenantId> [--rate N] [--functions A,B] [--origins a,b] [--actor who]
pnpm provision:tenant list
pnpm provision:tenant revoke <apiKey> [--actor who]
pnpm provision:admin  create --email a@x.com --role manager   # + list / delete
```

`create` prints the raw key **once** (only its sha256 is stored). `create`/`revoke` emit a
`tenant.provisioned` / `tenant.revoked` **audit line** to stdout (the log stream is the audit
trail). Tag the operator with `--actor`.

### Known gaps

- **`/readyz` is a stub** — returns `ok` unconditionally; does not verify Redis/vendor
  reachability. _Fix: probe `redis.ping()` (and a cheap vendor check) before it gates traffic._
- The GLM provider is unvalidated against z.ai's **live** API — smoke-test with a real key before
  production traffic.

---

## 9. Security & vendor threat model

The build takes runtime dependencies on two external vendors. This records what data reaches
each, the trust assumptions, and the mitigations.

| Vendor             | Role                                              | Data sent                                                                  | Enabled by                  |
| ------------------ | ------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------- |
| **Azure OpenAI**   | Per-function interpretation (structured output)   | The **extracted** document (markdown/text) + the prompt. Not the raw file. | `AZURE_OPENAI_ENABLED=true` |
| **GLM-OCR** (z.ai) | Layout-aware extraction (OCR, seals, handwriting) | The **raw file bytes** (PDF/image)                                         | `GLM_ENABLED=true`          |

Everything else — plain text, PDF text, DOCX, Tesseract OCR, tamper analysis, MRZ — runs
**in-process** and sends nothing to a third party. Both vendor calls are TLS in transit; the
residual risk is **vendor-side handling** (retention, training use, sub-processors, region).

### The PII concern

The `pii` functions (`ID_VERIFICATION`, `AUTO_EXTRACTION`, `LOAN_REVIEW`,
`BANK_STATEMENT_ANALYSIS`) are the crux:

- ✅ **PII never enters the async queue.** `POST /v1/ocr/:function` gates async on
  `sensitivity === "standard"`, so a `pii` file is never persisted to Redis — it runs inline,
  bytes held only in memory.
- ✅ **PII is not cached.** Extraction caching is disabled for sensitive functions.
- ✅ **PII is not logged or traced.** `createRedactingLogger` + trace body-capture disabled,
  enforced centrally in `src/pipeline.ts`.
- ⚠️ **PII functions require `text` only, so they do _not_ route to GLM today** — they use
  in-process text/Tesseract extraction, then Azure for interpretation. **The raw PII image does
  not reach GLM.** The extracted text (containing the ID fields) does reach **Azure**.

**Open risk:** the moment a `pii` function requires `layout`/`seals` (routing to GLM), or GLM is
made the image primary, **raw PII images will flow to GLM.** That must not ship without (a) a
signed DPA / retention-off confirmation, or (b) pointing `GLM_BASE_URL` at a **self-hosted** GLM
endpoint. This is one config change away, so it is written down.

### Mitigations in place

| Risk                     | Mitigation                                                                                         | Where                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Vendor lock-in           | `OcrProvider` interface + swappable `GLM_BASE_URL` → self-host without touching interpretation     | `src/providers/`                            |
| Secret exposure          | Vendor keys env-only, never logged; config fails closed (enable-without-key throws at boot)        | `src/config/env.ts`                         |
| Over-broad data to Azure | Azure gets extracted text, not raw files; sensitive-function redaction keeps it out of our logs    | `src/pipeline.ts`                           |
| PII to queue/cache       | Async + extraction-cache gated to `standard` sensitivity                                           | `src/http/routes.ts`                        |
| Runaway spend / abuse    | Per-tenant rate limit + plan quotas; bounded provider concurrency; token/cost metrics for alerting | rate-limit + billing + `src/providers/glm/` |

### Vetting checklist (before GLM is on the PII path)

- [ ] Signed DPA with z.ai / GLM: **no training on submitted data**, defined (ideally zero)
      retention.
- [ ] Confirm processing **region** meets residency requirements; else stand up self-hosted GLM
      and point `GLM_BASE_URL` at it.
- [ ] Same DPA/retention confirmation for **Azure OpenAI**.
- [ ] Name the owner accountable for this vetting.
- [ ] Re-review whenever a new `pii`/`restricted` function is added or a function's `requires`
      changes to pull in a vendor path.

**Summary:** today's exposure is bounded — no raw PII reaches an external OCR vendor, and
extracted PII reaches only Azure, kept out of our logs, traces, cache, and queue. The
one-way-door risk is **future** (wiring GLM into a `pii`/layout path); the mitigations are
designed in, what remains is the paperwork.

---

## 10. Governance: decisions, ownership & cost

The build is a **one-way door** (a new long-lived service, an auth model, two vendor
dependencies). This section is the standing framework plus the record of the decision.

### Decision framework

| Class            | Meaning                                                     | Examples                                                                |
| ---------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| **One-way door** | Hard/expensive to reverse. Commit deliberately, in writing. | New long-lived service, public API contract, vendor lock-in, auth model |
| **Two-way door** | Cheap to reverse. Bias to action; document lightly.         | An internal helper, a swappable provider, a config default              |

When unsure, treat it as one-way until shown otherwise.

**Record types** (ratified as the standing default):

| Situation                                    | Record                             | Reviewer                           |
| -------------------------------------------- | ---------------------------------- | ---------------------------------- |
| One-way door, contained within this service  | **ADR** (in the repo)              | A second engineer (second opinion) |
| Affects other teams / cross-cutting contract | **RFC** (circulated)               | Affected teams + owner             |
| Reversible, local, low blast-radius          | **Lead approval** (PR description) | Reviewing engineer                 |

**The ten questions** — answer in writing for any one-way-door decision:
(1) Does this solve the actual problem? (2) Is there an existing org solution? (reuse → subscribe
→ build) (3) Can it be simpler? (4) Will it still make sense in two years? (5) Is it observable?
(6) Is it secure? (7) Is it backwards compatible? (8) Can it be rolled back safely? (9) What is
the operational cost, and who owns it? (10) What technical debt does this introduce (ticketed
with a repayment trigger)?

### The decision (ADR summary)

Applied to "build and operate the Heirs OCR service," all ten answered ✅ with two watch items:

- **Problem/fit/simplicity/longevity** — the one load-bearing abstraction (`RecognizedDocument`)
  keeps the rest small; boring, well-supported stack (Express 5, Node 22+, Postgres, Redis, Zod,
  BullMQ, OpenTelemetry); additive extension; vendor swap designed in.
- **Observability/security/rollback** — export is real and config-gated; sha256-only key storage,
  declarative PII enforcement, fail-closed config; additive schema + graceful shutdown make
  redeploy-to-roll-back safe. **12-factor: 12/12.**
- **Verdict: proceed with the build.** All launch-blocking development gaps are closed and
  test-covered. Remaining items are process/governance, not code.

### Ownership

| Area                              | Owner   | Notes                                                       |
| --------------------------------- | ------- | ----------------------------------------------------------- |
| Service operation / on-call       | `admin` | Alerts + remediation in [§ 8](#8-observability--operations) |
| Cost sign-off                     | `admin` | Above the cost threshold (below)                            |
| Vendor relationships (Azure, GLM) | `owner` | DPA / data-residency decisions before PII paths             |
| API contract (`/v1/`)             | `owner` | Versioned-change discipline (principle 6)                   |
| Governance / one-way-door ADRs    | `owner` | Also the second-opinion reviewer                            |

### Cost sign-off

Recurring or usage-based spend above **`<COST_SIGNOFF_THRESHOLD>`** per month requires sign-off
from `admin` before it goes live — this exists for usage-based vendor spend (per-call LLM/OCR
costs) that scales with volume. **This threshold is the one open governance item**: set the
monthly figure and the decision record moves from `draft` to `accepted`.

---

## 11. Technical debt register

Named, with a repayment trigger. Most seams flagged during the build are now **repaid** (GLM,
async, observability export, graceful shutdown — all wired and test-covered). What remains:

| Debt                                  | Where                                                         | Repayment trigger                                                         |
| ------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `/readyz` is a static stub            | `src/main.ts`                                                 | Probe `redis.ping()` (+ cheap vendor check) before it gates real traffic  |
| GLM unvalidated against z.ai live API | `src/providers/glm/`                                          | Live-API smoke test + vendor DPA **before** any PII routes to GLM         |
| Cost sign-off threshold unset         | governance ([§ 10](#10-governance-decisions-ownership--cost)) | Set the monthly figure → flip the ADR to `accepted`                       |
| Deep tamper-forensics tier deferred   | `src/authenticity/`                                           | When corpus + `sharp`-class deps justify ELA/PRNU/copy-move + PDF diffing |

---

## 12. Roadmap: expansion use cases

The current thirteen functions compose into multi-stage industry pipelines, and there are
adjacent capabilities worth adding. This section is directional planning, not a commitment.

### Representative pipelines

The functions chain with decision gates and cross-document validation. Examples:

- **Employee onboarding** — classify a mixed upload → `ID_VERIFICATION` + `RESUME_PARSING` +
  `FORM_DATA_EXTRACTION` (I-9/W-4) + `SIGNING`, then a data-validation gate (name/address/date
  consistency across documents) before HRIS write.
- **Commercial loan origination** — classify → `ID_VERIFICATION`, `BANK_STATEMENT_ANALYSIS`
  (cash-flow, NSF), tax/pay-stub extraction → income reconciliation + tamper flags →
  underwriting-decision input (DSCR, LTV).
- **Insurance FNOL + claims**, **AP three-way matching**, **vendor onboarding & risk**, **real
  estate transactions**, **academic credential verification** — same shape: classify → per-doc
  extract/verify → a downstream gate (fraud, match, readiness) with `DOCUMENT_AUTHENTICITY` as
  the cross-cutting integrity check.

The consistent lesson: the **intelligence layer above extraction** — cross-document consistency
validation and tamper-aware gating — is where the differentiated value sits.

### Strategic capability gaps to consider

| Capability                            | Why it matters                                                    | Effort/value   |
| ------------------------------------- | ----------------------------------------------------------------- | -------------- |
| Table/structured-data extraction      | Financial statements, tax returns, bank statements are tabular    | Quick win      |
| Multi-language OCR                    | International trade, immigration, mixed scripts                   | Quick win      |
| Handwriting recognition               | Forms with handwritten fields (medical, insurance, legacy)        | Quick win      |
| Document comparison / diff            | Contract versions, policy renewals, amended filings               | High value     |
| Long-document chunking w/ context     | Contracts/policies/filings over ~100 pages                        | High value     |
| Redaction automation                  | Auto-redact PII/PHI for secondary use (FOIA, litigation, privacy) | High value     |
| Seal/stamp verification               | Notary/corporate/certified stamps — few competitors do this well  | Differentiator |
| Cross-document consistency validation | The "intelligence layer" above extraction                         | Differentiator |
| Barcode / QR reading                  | Shipping labels, wristbands, asset tags                           | Adjacent       |

Several of these (tables, handwriting, seals) are already GLM-OCR capabilities awaiting a
consuming function.
