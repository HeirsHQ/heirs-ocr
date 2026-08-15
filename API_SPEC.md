# Heirs OCR — API Specification

| **Document Version** | **1.0.1**                  |
| -------------------- | -------------------------- |
| **Classification**   | **Internal (Engineering)** |
| **Project/System**   | **Heirs OCR Service**      |
| **Prepared By**      | **Samson Okunola**         |

## Table of contents

1. [Document control](#document-control)
2. [Approval block](#approval-block)
3. [Introduction](#introduction)
4. [Conventions](#common-conventions)
5. [OCR API](#ocr-api--v1ocr) — the caller-facing contract
6. [Security](#security)
7. [Subscriptions & entitlements](#subscriptions--entitlements)
8. [Error handling and status codes](#error-handling-and-status-codes)
9. [Function catalog](#function-catalog)
10. [Appendix A — Tenant Portal API](#appendix-a--tenant-portal-api-tenantapi)
11. [Appendix B — Admin API](#appendix-b--admin-api-adminapi)
12. [Glossary](#glossary)

## Document control

| Version | Date       | Author         | Change summary                                                                                                                                                                                                                                                                  |
| ------- | ---------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.0.1   | 2026-07-29 | Samson Okunola | Initial engineering specification for review.                                                                                                                                                                                                                                   |
| 1.0.0   | 2026-08-12 | Samson Okunola | Reconciled with the shipped service: 13 functions; Postgres-backed auth; GLM-OCR and async paths wired; subscription/billing entitlements; new error codes (`NOT_FOUND`, `PAYMENT_REQUIRED`, `QUOTA_EXCEEDED`, `INTERNAL`); Tenant Portal and Admin management APIs documented. |

This document is the source of truth for the **external contract and security posture** of
the Heirs OCR Service. Changes to any endpoint, error code, authentication mechanism, or
data-classification rule described here require a version bump and re-approval.
[TECHNICAL.md](./TECHNICAL.md) describes _how_ the service is built; this document describes
_what it guarantees to callers_.

## Approval block

| Role                       | Name                 | Signature | Date       |
| -------------------------- | -------------------- | --------- | ---------- |
| Author / Engineer          | Samson Okunola       | S.Okunola | 12/08/2026 |
| Engineering Lead           | Monsuru Abdullahi    |           |            |
| Head, Software Engineering | Israel Emoitologa    |           |            |
| Security Reviewer          | Nathaniel Oladunmomi |           |            |
| Product Owner              |                      |           |            |

## Introduction

### Purpose

The Heirs OCR Service converts uploaded documents (PDF, image, DOCX, plain text) into
structured, validated data. It exposes a small, uniform HTTP API in which a caller selects
a **function** — a specific interpretation task such as receipt parsing or ID verification —
uploads a file, and receives a typed JSON result.

The guiding principle is **extraction is shared, interpretation is per-function.** Any
supported input is first normalized into a single canonical `RecognizedDocument`
(markdown + layout blocks), then the selected function interprets that canonical form. This
keeps the surface area small and makes new capabilities additive.

### Scope

**In scope for this version:**

- The synchronous request path: `POST /v1/ocr/:function`, returning a result in one round trip.
- The asynchronous path: uploads over the size/page thresholds return `202 Accepted` with a
  `statusUrl`, and `GET /v1/ocr/jobs/:id` reports status and result.
- The function catalog: `GET /v1/ocr/functions`.
- Liveness/readiness probes and the Prometheus scrape endpoint.
- The **thirteen** document functions in [Function catalog](#function-catalog).
- API-key authentication, per-tenant authorization, subscription entitlements, rate
  limiting, and the data-sensitivity policy.
- The management surfaces: the **Tenant Portal API** (Appendix A) and **Admin API**
  (Appendix B).

**Environment gating.** LLM-backed functions run only when Azure OpenAI is configured
(`AZURE_OPENAI_ENABLED=true`); otherwise they return a clear configuration error.
`TEXT_EXTRACTION` and `DOCUMENT_AUTHENTICITY` require no LLM. `SIGNING` (and any function
requiring `layout`/`seals`) requires the GLM-OCR provider (`GLM_ENABLED=true`); when GLM is
off, image/scanned-PDF extraction falls back to Tesseract and `SIGNING` cannot be served.

### Intended audience

- **Backend engineers** integrating with or extending the service.
- **Client/integration engineers** consuming the API from other Heirs systems (server-to-server).
- **Security reviewers** assessing the authentication, authorization, and data-handling controls.

### Reference documents

| Document                  | Location                             | Contents                                                                                |
| ------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| Technical reference       | [TECHNICAL.md](./TECHNICAL.md)       | Architecture, providers, GLM-OCR, tamper detection, billing, ops, security, governance. |
| Contribution guide        | [CONTRIBUTION.md](./CONTRIBUTION.md) | Setup, build, test, and extension conventions.                                          |
| Environment configuration | `src/config/env.ts`, `.env.example`  | All tunables and their defaults.                                                        |

## Common conventions

**Base URL:** `/v1/ocr` **Transport:** HTTPS, server-to-server (CORS default-closed; browser
origins are not permitted unless explicitly configured). **Content types:** requests use
`multipart/form-data`; responses are `application/json`.

- **File field:** the uploaded document is sent in the `file` multipart field. Exactly one
  file per request.
- **Args field:** function arguments are sent in the `args` multipart field as a **JSON
  string**. Optional; an empty/absent value is treated as `{}` and defaults apply.
- **File type is sniffed, not trusted.** The service ignores the client-supplied filename and
  MIME type and determines the true type from the file's magic bytes. A `.pdf` that is
  actually a JPEG is routed as an image; an unsupported binary is rejected.
- **Request ID:** every response (success or error) carries a `requestId`. Callers should log
  it and quote it in support requests.
- **Size cap:** uploads are capped at `MAX_FILE_SIZE_BYTES` (default 50 MiB), enforced during
  upload buffering. A subscription plan may impose a tighter per-document cap.

## OCR API — `/v1/ocr`

### 1. `GET /v1/ocr/functions` — Function catalog

Returns the catalog of available functions with their JSON Schemas, so callers can discover
capabilities, generate forms, and validate args client-side.

**Auth:** not required.

**Response 200:**

```json
{
  "functions": [
    {
      "key": "RECEIPT_PARSING",
      "description": "Parse a receipt into structured line items and totals.",
      "accepts": ["pdf", "image"],
      "requires": ["text", "tables"],
      "sensitivity": "standard",
      "maxPages": 5,
      "argsSchema": { "...": "JSON Schema for the args object" },
      "resultSchema": { "...": "JSON Schema for the result object" }
    }
  ]
}
```

`resultSchema` is omitted for dynamic-schema functions (e.g. `FORM_DATA_EXTRACTION`) whose
output shape depends on the args. The live catalog is authoritative for the exact `accepts`,
`maxPages`, and schemas; the [Function catalog](#function-catalog) table is a summary.

### 2. `POST /v1/ocr/:function` — Run a function

Runs the named function against an uploaded file and returns the validated result. Large or
multi-page uploads are queued instead (see [Async path](#3-async-path)).

**Path parameter:** `:function` — one of the catalog keys (e.g. `RECEIPT_PARSING`).

**Middleware order (each can short-circuit with a typed error):**
`auth → authorize → requireSubscription → rate-limit → sensitivity → upload → pipeline`.

**Request (`multipart/form-data`):**

| Field  | Type   | Required | Notes                                      |
| ------ | ------ | -------- | ------------------------------------------ |
| `file` | binary | yes      | The document. One file only.               |
| `args` | string | no       | JSON string of the function's args object. |

**Example (curl):**

```bash
curl -X POST https://<host>/v1/ocr/RECEIPT_PARSING \
  -H "Authorization: Bearer <api-key>" \
  -F "file=@receipt.jpg" \
  -F 'args={"currency":"NGN","expectedTaxRate":0.075}'
```

**Pipeline stages** (all in `src/pipeline.ts`; identical for sync and async):

1. **Ingest** — parse multipart, sniff magic bytes, SHA-256 the buffer, validate the detected
   type against the function's `accepts`.
2. **Extract** — route to a provider by required capability, recognize into a
   `RecognizedDocument`, with a fallback chain on provider error, and (for
   standard-sensitivity functions) an extraction cache.
3. **Interpret** — run the function's `execute` step (Azure OpenAI structured output for LLM
   functions; deterministic for the rest).
4. **Validate** — validate the output against the function's Zod result schema plus any
   business rules; only a conforming result is returned.

**Response 200 (success envelope):**

```json
{
  "requestId": "req_9f2a1c…",
  "function": "RECEIPT_PARSING",
  "result": {
    "merchant": { "name": "…", "address": "…", "tin": null },
    "dateTime": "2026-07-20T14:03:00",
    "currency": "NGN",
    "lineItems": [{ "description": "…", "qty": 2, "unitPrice": 500, "total": 1000 }],
    "subtotal": 1000,
    "tax": 75,
    "tip": null,
    "total": 1075,
    "paymentMethod": "CARD",
    "confidence": "high",
    "warnings": []
  },
  "meta": {
    "provider": "tesseract",
    "fellBackFrom": null,
    "pageCount": 1,
    "cached": false,
    "durationMs": 812,
    "tokensUsed": 1340
  }
}
```

The `result` shape is function-specific (see the catalog schemas). `meta` is uniform across
functions and reports which provider ran, whether a fallback occurred, page count, cache
status, latency, and token usage where applicable.

### 3. Async path

When an upload exceeds `ASYNC_SIZE_THRESHOLD_BYTES` or `ASYNC_PAGE_THRESHOLD` pages, a
`standard`-sensitivity request is queued rather than processed inline:

**Response 202 (`POST /v1/ocr/:function`):**

```json
{ "requestId": "req_…", "jobId": "job_…", "status": "queued", "statusUrl": "/v1/ocr/jobs/job_…" }
```

A worker (`node build/worker.js`) runs the identical `runPipeline` off-request. `pii` and
`restricted` files are **never enqueued** — they always run inline and are held only in memory.

**`GET /v1/ocr/jobs/:id`** — job status + result. Requires auth. Scoped to the submitting
tenant: another tenant's job id resolves to `NOT_FOUND` (ids can't be enumerated across
tenants). Returns the job record (`status`, and `result`/`meta` on completion, or a typed
error code on failure).

### 4. Health, readiness & metrics

| Endpoint       | Purpose              | Auth                                 | Response                         |
| -------------- | -------------------- | ------------------------------------ | -------------------------------- |
| `GET /`        | Service banner       | none                                 | `{ "message": "Heirs OCR API" }` |
| `GET /healthz` | Liveness             | none                                 | `{ "status": "ok" }`             |
| `GET /readyz`  | Readiness (see note) | none                                 | `{ "status": "ok" }`             |
| `GET /metrics` | Prometheus scrape    | bearer (`METRICS_AUTH_TOKEN`) if set | Prometheus text format           |

> **Note:** `/readyz` currently returns a static `ok` and does not yet probe Redis or vendor
> reachability. Do not treat it as a dependency-health gate. See TECHNICAL.md § Known gaps.

## Security

### Privacy and data classification

Every function declares a `sensitivity` level, and that declaration — not any per-call flag —
drives the handling policy centrally, where it cannot be bypassed at an individual call site.

| Level        | Meaning                                | Applies to                                                                     |
| ------------ | -------------------------------------- | ------------------------------------------------------------------------------ |
| `standard`   | Ordinary business documents            | Most functions                                                                 |
| `pii`        | Personal identifying information       | `ID_VERIFICATION`, `AUTO_EXTRACTION`, `LOAN_REVIEW`, `BANK_STATEMENT_ANALYSIS` |
| `restricted` | Reserved for future higher-sensitivity | —                                                                              |

For any non-standard function the service enforces, at distinct layers:

- **No raw text in logs.** The pipeline builds a redacting logger so document text and
  extracted identity fields never reach the log sink.
- **No trace body capture.** The interpretation span is created with result capture disabled.
- **`Cache-Control: no-store`** on the HTTP response.
- **No extraction caching** and **no async queueing** — a `pii`/`restricted` file is never
  persisted to Redis; it runs inline and its bytes are held only in memory.

**Upload handling:** files are held in memory only (never written to disk by the service),
size-capped before buffering completes, and limited to one file per request. The buffer's
SHA-256 is used as the cache key and trace-correlation id; the raw content is not persisted
beyond request handling (or the extraction cache TTL, for standard functions only).

### Authentication

- **Mechanism:** API-key. The caller sends `Authorization: Bearer <key>` or `X-API-Key: <key>`.
  In-app callers (the tenant portal) may instead present the tenant **session cookie**, which
  the OCR auth middleware accepts when no API key is present.
- **Storage:** keys are never stored in plaintext. The tenant registry lives in **Postgres**,
  keyed by the **SHA-256 of the API key**, so a database dump cannot be replayed as
  credentials. Newly minted keys use `hok_test_<uuid>` outside production and
  `hok_live_<uuid>` in production; legacy opaque keys remain valid because the
  server treats the submitted key as an opaque secret before hashing it.
- **Resolution:** a valid key resolves to a tenant, setting `req.tenantId` which scopes rate
  limiting, authorization, subscription, and caching. Resolution uses a short-TTL positive
  cache (`API_KEY_CACHE_TTL_SECONDS`) to stay off the Postgres hot path and ride out brief blips.
- **Fail-closed:** if the auth store is unreachable and nothing is cached, the request is
  **rejected** (503 `PROVIDER_UNAVAILABLE`, retryable) rather than admitted.
- **Revocation:** keys can be hard-revoked or soft-revoked (a disabled flag) at runtime, with
  no redeploy. The auth cache TTL bounds how long a revoked key stays valid.
- **Local-dev bypass:** `AUTH_ENABLED=false` disables auth entirely and assigns the anonymous
  tenant. **Throws at boot when `NODE_ENV=production`.**

### Authorization

- **Per-function scoping.** A tenant record may carry an `allowedFunctions` list. If present
  and non-empty, the requested `:function` must be in it; otherwise the request is rejected
  with 403 `FORBIDDEN`. An omitted/empty list allows all functions.
- **Subscription entitlements** layer on top of this — see next section.
- **Rate limiting.** Per-tenant fixed-window counter in Redis, keyed on `tenantId` (falling
  back to client IP). Default `RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_SECONDS`
  (defaults 60 per 60 s), overridable per tenant and per plan. Exhaustion returns 429
  `RATE_LIMITED` (retryable). The limiter is **fail-open**: if Redis is unreachable it logs a
  warning and allows the request.

> **Deliberate asymmetry:** authentication **fails closed** (a broken security control must not
> admit traffic) while rate limiting **fails open** (a broken availability control must not
> deny traffic).

- **CORS.** Default-closed. The service is server-to-server; browser origins are not accepted
  unless explicitly configured (`CORS_ALLOWED_ORIGINS`). The `/admin` and `/tenant` management
  APIs are same-origin (served alongside the frontend) and need no CORS entry.

## Subscriptions & entitlements

A tenant may be enrolled in a **subscription** to a **plan**. The `requireSubscription`
middleware (running after `authorize`, before `rate-limit`) loads the subscription and gates
the request on plan status, function entitlement, sensitivity ceiling, and document quota — and
publishes the plan's per-minute rate ceiling onto the rate limiter.

- **Backward-compatible:** a tenant with **no subscription** (or a briefly unreachable billing
  store) is treated as **unlimited** — nothing is gated. Only an explicit subscription imposes
  limits.
- **Status gate:** `trialing`, `active`, and `past_due` are served; `expired`, `canceled`, and
  `suspended` are rejected with 402 `PAYMENT_REQUIRED`.
- **Entitlement gate:** a function outside the plan's `allowedFunctions`, or above its
  `maxSensitivity` ceiling, is rejected with 403 `FORBIDDEN`.
- **Quota gate:** an exhausted period/trial document allowance is rejected with 429
  `QUOTA_EXCEEDED` (retryable next period or after upgrade). Monthly plans with an overage
  price never hard-stop — they bill the overage.
- **Metering:** each processed document is metered against the subscription (period usage +
  per-document/overage charge + trial burn-down). The inline path meters on completion; async
  jobs are metered by the worker.

Plan tiers, prices, and limits are defined in TECHNICAL.md § Billing & subscriptions. Plans are
managed as data via the Admin API (Appendix B).

## Error handling and status codes

All errors are returned as a single uniform envelope. A raw provider or internal error is
never surfaced; every error is mapped to a typed code that callers can switch on.

**Error envelope:**

```json
{
  "error": {
    "code": "FILE_TOO_LARGE",
    "message": "Human-readable explanation.",
    "requestId": "req_9f2a1c…",
    "retryable": false,
    "details": null
  }
}
```

`retryable` tells the caller whether a straight retry may succeed. `details` is optional and,
when present, carries structured validation issues.

**Codes and HTTP status:**

| Code                       | HTTP | Retryable | When                                                                        |
| -------------------------- | ---- | --------- | --------------------------------------------------------------------------- |
| `UNAUTHORIZED`             | 401  | no        | Missing, invalid, or revoked API key.                                       |
| `PAYMENT_REQUIRED`         | 402  | no        | No active/paid subscription (expired, canceled, or suspended).              |
| `FORBIDDEN`                | 403  | no        | Key/plan not authorized for the function, or above the sensitivity ceiling. |
| `NOT_FOUND`                | 404  | no        | Unknown job id (or one belonging to another tenant).                        |
| `INVALID_ARGS`             | 400  | no        | Unknown function, missing file, or bad args.                                |
| `FILE_TOO_LARGE`           | 413  | no        | Upload exceeds `MAX_FILE_SIZE_BYTES` or the plan's file cap.                |
| `UNSUPPORTED_MEDIA_TYPE`   | 415  | no        | Sniffed type unsupported or not in the function's `accepts`.                |
| `PAGE_LIMIT_EXCEEDED`      | 422  | no        | Document exceeds the function's (or plan's) `maxPages`.                     |
| `NO_TEXT_DETECTED`         | 422  | no        | Extraction produced no usable text.                                         |
| `SCHEMA_VALIDATION_FAILED` | 422  | no        | Function output failed its result schema/business rules.                    |
| `RATE_LIMITED`             | 429  | yes       | Per-tenant/plan rate limit exceeded.                                        |
| `QUOTA_EXCEEDED`           | 429  | yes       | Plan/trial document allowance exhausted (retry next period or upgrade).     |
| `EXTRACTION_FAILED`        | 502  | yes       | All providers in the fallback chain failed.                                 |
| `INTERPRETATION_FAILED`    | 502  | no        | The function's execute/LLM step failed.                                     |
| `PROVIDER_UNAVAILABLE`     | 503  | yes       | Auth store, queue, or a required provider is unreachable.                   |
| `INTERNAL`                 | 500  | no        | Unexpected server-side fault (a bug, not a provider/input problem).         |

**Fallback behaviour.** During extraction, if the primary provider errors, the service tries
each configured fallback in turn. A successful fallback stamps `meta.fellBackFrom` with the
primary provider's name; only if the entire chain fails is `EXTRACTION_FAILED` returned.

## Function catalog

The live `GET /v1/ocr/functions` response is authoritative. Summary of the thirteen functions:

| Function key              | Purpose                                                                | Accepts                | LLM    | Sensitivity |
| ------------------------- | ---------------------------------------------------------------------- | ---------------------- | ------ | ----------- |
| `TEXT_EXTRACTION`         | Return the canonical extracted text/markdown.                          | pdf, image, docx, text | no     | standard    |
| `DOCUMENT_CLASSIFICATION` | Classify the document into a type.                                     | pdf, image, docx, text | yes    | standard    |
| `RECEIPT_PARSING`         | Structured line items, totals, tax reconciliation.                     | pdf, image             | yes    | standard    |
| `FORM_DATA_EXTRACTION`    | Extract caller-specified fields (dynamic schema).                      | pdf, image, docx, text | yes    | standard    |
| `RESUME_PARSING`          | Structured résumé (contact, experience, education).                    | pdf, image, docx, text | yes    | standard    |
| `ID_VERIFICATION`         | Read ID fields + MRZ; verify against expected values.                  | pdf, image             | yes    | **pii**     |
| `SIGNING`                 | Detect signatures/seals and execution status.                          | pdf, image             | vision | standard    |
| `DOCUMENT_AUTHENTICITY`   | Deterministic tamper analysis on raw bytes (no OCR, no LLM).           | pdf, image             | no     | standard    |
| `AUTO_EXTRACTION`         | Classify the document, then route it to the matching parser.           | pdf, image, docx       | yes    | **pii**     |
| `BUDGET_ANALYSIS`         | Categorized budget line items + deterministic totals reconciliation.   | pdf, image, docx       | yes    | standard    |
| `EXPENSE_CLAIM`           | Claimant, line items, totals + reconciliation + missing-receipt check. | pdf, image, docx       | yes    | standard    |
| `LOAN_REVIEW`             | Borrower financials + deterministic affordability recommendation.      | pdf, image             | yes    | **pii**     |
| `BANK_STATEMENT_ANALYSIS` | Transactions/balances + inflow/outflow reconciliation.                 | pdf, image             | yes    | **pii**     |

`SIGNING` requires the GLM-OCR provider (`layout`, `seals` capabilities). `pii` functions are
never cached or queued and always run inline.

## Appendix A — Tenant Portal API (`/tenant/api`)

Same-origin JSON API for a tenant's own users (served behind the Next.js portal). All routes
except login require a **tenant session cookie**; management routes require the `owner` role.
Every route is scoped to the caller's own tenant org — a tenant can never read or mutate
another org's keys or users. Errors use a `{ error: { code, message } }` shape.

| Method + path            | Role   | Purpose                                                                          |
| ------------------------ | ------ | -------------------------------------------------------------------------------- |
| `POST /api/login`        | open   | Authenticate; sets the session cookie. Login-throttled.                          |
| `POST /api/logout`       | member | Destroy the session.                                                             |
| `GET  /api/me`           | member | Current user + tenant + role.                                                    |
| `GET  /api/billing`      | member | Current subscription plus lifetime OCR usage counters.                           |
| `GET  /api/keys`         | owner  | List the org's API keys (hash + prefix, expiry, status; never the secret).       |
| `POST /api/keys`         | owner  | Mint a new API key with optional `expiresAt` — the raw key is returned **once**. |
| `DELETE /api/keys/:hash` | owner  | Revoke one of the org's keys.                                                    |
| `GET  /api/users`        | owner  | List team members.                                                               |
| `POST /api/users`        | owner  | Create a team member (`owner`/`member`).                                         |
| `PATCH /api/users/:id`   | owner  | Update a member (guards against removing the last owner).                        |
| `DELETE /api/users/:id`  | owner  | Delete a member (guards against deleting the last owner).                        |

## Appendix B — Admin API (`/admin/api`)

Same-origin JSON API for platform operators, backing the admin console. Login is open;
everything else requires an **admin session cookie** and the appropriate role
(`owner` > `manager` > `viewer`). Admin users and passwords (argon2id) live in Postgres; the
first owner is seeded from env at startup.

| Method + path                                                 | Min role    | Purpose                                           |
| ------------------------------------------------------------- | ----------- | ------------------------------------------------- |
| `POST /api/login` · `POST /api/logout` · `GET /api/me`        | — / session | Session lifecycle.                                |
| `GET/POST /api/admins`, `PATCH/DELETE /api/admins/:id`        | owner       | Manage admin users.                               |
| `GET/POST /api/tenants`, `PATCH/DELETE /api/tenants/:keyHash` | manager     | Manage tenants and their keys/limits.             |
| `GET/POST /api/tenants/:tenantId/users`                       | manager     | Manage a tenant's portal users.                   |
| `GET/POST /api/plans`, `PUT/DELETE /api/plans/:id`            | owner       | Manage the subscription plan catalog (DB-backed). |
| `GET/PUT /api/tenants/:tenantId/subscription`                 | manager     | Read/assign a tenant's subscription.              |
| `GET /api/functions`                                          | viewer      | The function catalog (as `/v1/ocr/functions`).    |
| `GET /api/metrics/summary`                                    | viewer      | Request counts, error rate, tokens, fallbacks.    |
| `GET /api/usage`                                              | viewer      | Per-tenant usage counters.                        |
| `GET /api/queue`                                              | viewer      | BullMQ queue depth + recent jobs.                 |
| `GET /api/health`                                             | viewer      | Health/provider matrix.                           |

## Glossary

| Term                    | Definition                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Function**            | A named interpretation task (e.g. `RECEIPT_PARSING`) selected via the URL path.                                                    |
| **Capability**          | A skill a provider offers (`text`, `layout`, `tables`, `handwriting`, `seals`); a function declares which it `requires`.           |
| **RecognizedDocument**  | The canonical extraction output (markdown, plain text, pages, layout blocks) every provider returns.                               |
| **Provider**            | An extraction engine (pdf-parse, Mammoth, Tesseract, GLM-OCR, plain-text) that produces a `RecognizedDocument`.                    |
| **Fallback chain**      | The ordered list of providers tried on error before an extraction is declared failed.                                              |
| **Tenant**              | The identity resolved from an API key; scopes authorization, rate limiting, subscription, and caching.                             |
| **Subscription / Plan** | A tenant's live enrolment in a catalog plan; drives entitlements, quotas, and rate ceilings.                                       |
| **Sensitivity**         | A per-function classification (`standard`/`pii`/`restricted`) that centrally drives logging, caching, queueing, and cache-control. |
| **MRZ**                 | Machine-Readable Zone — the checksum-bearing text band on passports/IDs, parsed and verified by `ID_VERIFICATION`.                 |
| **Sniff**               | Determining a file's true type from its magic bytes rather than the client-supplied name/MIME.                                     |
| **Structured output**   | Azure OpenAI generation constrained to a JSON Schema derived from the function's Zod result schema.                                |
