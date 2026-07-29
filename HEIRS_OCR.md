# Heirs OCR Specification

|                |                        |
| -------------- | ---------------------- |
| Version        | 0.0.1                  |
| Classification | Internal (Engineering) |
| Project/System | Heirs OCR Service      |
| Prepared By    | Samson Okunola         |

Table of Contents

- Document Control
- Approval Block
- Introduction
  - Purpose
  - Scope
  - Intended Audience
  - Reference Documents
- API / Endpoint Specification
  - Endpoint Details
- Security
  - Privacy and Data Classification
  - Authentication
  - Authorisation
- Error Handling and Status Codes
- Testing and Validation
- Glossary

---

## Document Control

| Version | Date       | Author         | Change Summary                                |
| ------- | ---------- | -------------- | --------------------------------------------- |
| 0.0.1   | 2026-07-29 | Samson Okunola | Initial engineering specification for review. |

This document is the source of truth for the external contract and security posture of
the Heirs OCR Service. Changes to any endpoint, error code, authentication mechanism, or
data-classification rule described here require a version bump and re-approval. The
companion internal design references (`docs/architecture.md`, `docs/glm-ocr.md`,
`docs/tamper-detection.md`) describe _how_ the service is built; this document describes
_what it guarantees to callers_.

## Approval Block

| Role              | Name | Signature | Date |
| ----------------- | ---- | --------- | ---- |
| Author / Engineer |      |           |      |
| Engineering Lead  |      |           |      |
| Security Reviewer |      |           |      |
| Product Owner     |      |           |      |

---

## Introduction

### Purpose

The Heirs OCR Service converts uploaded documents (PDF, image, DOCX, plain text) into
structured, validated data. It exposes a small, uniform HTTP API in which a caller
selects a **function** — a specific interpretation task such as receipt parsing or ID
verification — uploads a file, and receives a typed JSON result.

The guiding design principle is: **extraction is shared, interpretation is
per-function.** Any supported input is first normalized into a single canonical
`RecognizedDocument` (markdown + layout blocks), then the selected function interprets
that canonical form. This keeps the surface area small and makes new capabilities
additive.

### Scope

**In scope for this version:**

- The synchronous request path: `POST /v1/ocr/:function`, returning a result in one
  round trip.
- The function catalog endpoint: `GET /v1/ocr/functions`.
- Liveness/readiness probes: `GET /healthz`, `GET /readyz`.
- The eight document functions listed in [Endpoint Details](#endpoint-details).
- API-key authentication, per-tenant authorization and rate limiting, and the
  data-sensitivity policy.

**Out of scope / staged (not yet wired — see `docs/architecture.md`):**

- The asynchronous job path. `GET /v1/ocr/jobs/:id` is reserved and currently returns a
  typed "not implemented" error; large/multi-page requests do not yet enqueue.
- The GLM-OCR provider (client/chunker/mapper are stubbed). This blocks the `SIGNING`
  function and layout/seal-dependent extraction until connected.
- The Redis extraction cache (a no-op cache is injected until it lands).
- Metrics/tracing export to Prometheus/OpenTelemetry (currently in-memory only).

LLM-backed functions run only when Azure OpenAI is configured
(`AZURE_OPENAI_ENABLED=true`); otherwise they return a clear configuration error.
`TEXT_EXTRACTION` and `DOCUMENT_AUTHENTICITY` require no LLM.

### Intended Audience

- **Backend engineers** integrating with or extending the service.
- **Client/integration engineers** consuming the API from other Heirs systems
  (server-to-server).
- **Security reviewers** assessing the authentication, authorization, and data-handling
  controls.

### Reference Documents

| Document                  | Location                            | Contents                                               |
| ------------------------- | ----------------------------------- | ------------------------------------------------------ |
| Architecture reference    | `docs/architecture.md`              | Internal layering, request pipeline, provider routing. |
| GLM-OCR provider notes    | `docs/glm-ocr.md`                   | The vision OCR provider integration (staged).          |
| Tamper-detection notes    | `docs/tamper-detection.md`          | Deterministic authenticity analysis internals.         |
| Environment configuration | `src/config/env.ts`, `.env.example` | All tunables and their defaults.                       |

---

## API / Endpoint Specification

**Base URL:** `/v1/ocr`
**Transport:** HTTPS, server-to-server (CORS default-closed; browser origins are not
permitted unless explicitly configured per tenant).
**Content types:** requests use `multipart/form-data`; responses are `application/json`.

### Common conventions

- **File field:** the uploaded document is sent in the `file` multipart field. Exactly
  one file per request.
- **Args field:** function arguments are sent in the `args` multipart field as a **JSON
  string**. It is optional; an empty/absent value is treated as `{}` and defaults apply.
- **File type is sniffed, not trusted.** The service ignores the client-supplied
  filename and MIME type and determines the true type from the file's magic bytes. A
  `.pdf` that is actually a JPEG is routed as an image; an unsupported binary is
  rejected.
- **Request ID:** every response (success or error) carries a `requestId`. Callers
  should log it and quote it in support requests.
- **Size cap:** uploads are capped at `MAX_FILE_SIZE_BYTES` (default 50 MiB), enforced
  during upload buffering.

### Endpoint Details

#### 1. `GET /v1/ocr/functions` — Function catalog

Returns the catalog of available functions with their JSON Schemas, so callers can
discover capabilities, generate forms, and validate `args` client-side.

**Auth:** not required.

**Response `200`:**

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

`resultSchema` is omitted for dynamic-schema functions (e.g. `FORM_DATA_EXTRACTION`)
whose output shape depends on the args.

**Catalog of functions:**

| Function `key`            | Purpose                                                      | Accepts                | LLM    | Sensitivity |
| ------------------------- | ------------------------------------------------------------ | ---------------------- | ------ | ----------- |
| `TEXT_EXTRACTION`         | Return the canonical extracted text/markdown.                | pdf, image, docx, text | no     | standard    |
| `DOCUMENT_CLASSIFICATION` | Classify the document into a type.                           | pdf, image, docx, text | yes    | standard    |
| `RECEIPT_PARSING`         | Structured line items, totals, tax reconciliation.           | pdf, image             | yes    | standard    |
| `FORM_DATA_EXTRACTION`    | Extract caller-specified fields (dynamic schema).            | pdf, image, docx, text | yes    | standard    |
| `RESUME_PARSING`          | Structured résumé (contact, experience, education).          | pdf, image, docx, text | yes    | standard    |
| `ID_VERIFICATION`         | Read ID fields + MRZ; verify against expected values.        | pdf, image             | yes    | **pii**     |
| `SIGNING`                 | Detect signatures/seals and their layout positions.          | pdf, image             | vision | standard    |
| `DOCUMENT_AUTHENTICITY`   | Deterministic tamper analysis on raw bytes (no OCR, no LLM). | pdf, image             | no     | standard    |

> The exact `accepts`, `maxPages`, and schemas are authoritative in the live catalog
> response; the table is a summary. `SIGNING` depends on the staged GLM-OCR provider.

#### 2. `POST /v1/ocr/:function` — Run a function (synchronous)

Runs the named function against an uploaded file and returns the validated result.

**Path parameter:** `:function` — one of the catalog keys (e.g. `RECEIPT_PARSING`).

**Middleware order (each can short-circuit with a typed error):**
`auth → authorize → rate-limit → sensitivity → upload → pipeline`.

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

**Pipeline stages** (all in `src/pipeline.ts`; identical for sync and future async):

1. **Ingest** — parse multipart, sniff magic bytes, SHA-256 the buffer, validate the
   detected type against the function's `accepts`.
2. **Extract** — route to a provider by required capability, recognize into a
   `RecognizedDocument`, with a fallback chain on provider error, and (for
   `standard`-sensitivity functions) an extraction cache.
3. **Interpret** — run the function's `execute` step (Azure OpenAI structured output for
   LLM functions; deterministic for the rest).
4. **Validate** — validate the output against the function's Zod result schema plus any
   business rules; only a conforming result is returned.

**Response `200` (success envelope):**

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

The `result` shape is function-specific (see the catalog schemas). `meta` is uniform
across functions and reports which provider ran, whether a fallback occurred, page
count, cache status, latency, and token usage where applicable.

#### 3. `GET /v1/ocr/jobs/:id` — Async job status (reserved)

Reserved for the asynchronous path. Currently returns a typed
`INTERPRETATION_FAILED` "not implemented" error. When wired, large/multi-page requests
will return `202 Accepted` with `{ "jobId", "statusUrl" }`, and this endpoint will
report job status and the eventual result.

#### 4. Health probes

| Endpoint       | Purpose         | Response                         |
| -------------- | --------------- | -------------------------------- |
| `GET /`        | Service banner. | `{ "message": "Heirs OCR API" }` |
| `GET /healthz` | Liveness.       | `{ "status": "ok" }`             |
| `GET /readyz`  | Readiness.      | `{ "status": "ok" }`             |

---

## Security

### Privacy and Data Classification

Every function declares a `sensitivity` level, and that declaration — not any per-call
flag — drives the handling policy centrally, where it cannot be bypassed at an
individual call site.

| Level        | Meaning                                 | Applies to        |
| ------------ | --------------------------------------- | ----------------- |
| `standard`   | Ordinary business documents.            | Most functions.   |
| `pii`        | Personal identifying information.       | `ID_VERIFICATION` |
| `restricted` | Reserved for future higher-sensitivity. | —                 |

For any non-`standard` function the service enforces, at distinct layers:

- **No raw text in logs.** The pipeline builds a redacting logger so document text and
  extracted identity fields never reach the log sink.
- **No trace body capture.** The interpretation span is created with result capture
  disabled.
- **`Cache-Control: no-store`** on the HTTP response, so PII responses are not cached by
  browsers or intermediaries.
- **No extraction caching.** The extraction cache is skipped entirely for
  non-`standard` sensitivity.

**Upload handling:** files are held in memory only (never written to disk by the
service), size-capped before buffering completes, and limited to one file per request.
The buffer's SHA-256 is used as the cache key and trace-correlation id; the raw content
is not persisted beyond request handling (or the extraction cache TTL, for `standard`
functions only).

### Authentication

- **Mechanism:** API-key. The caller sends `Authorization: Bearer <key>` or
  `X-API-Key: <key>`.
- **Storage:** keys are never stored in plaintext. A tenant registry lives in a single
  Redis hash keyed by the **SHA-256 of the API key**, so a Redis dump cannot be replayed
  as credentials. Keys are high-entropy 256-bit random tokens (43-char base64url), for
  which SHA-256 — not bcrypt/argon2 — is the correct, fast choice.
- **Resolution:** a valid key resolves to a `tenant`, setting `req.tenantId` which scopes
  rate limiting, authorization, and caching. Resolution uses a short-TTL positive cache
  to stay off the Redis hot path and to ride out brief Redis blips.
- **Fail-closed:** if the auth store is unreachable and nothing is cached, the request is
  **rejected** (`503 PROVIDER_UNAVAILABLE`, retryable) rather than admitted.
- **Revocation:** keys can be hard-revoked (`HDEL`) or soft-revoked (a `disabled` flag)
  at runtime, with no redeploy.
- **Local-dev bypass:** `AUTH_ENABLED=false` disables auth entirely and assigns the
  `anonymous` tenant. **Never enable in production.**

### Authorisation

- **Per-function scoping.** A tenant record may carry an `allowedFunctions` list. If
  present and non-empty, the requested `:function` must be in it; otherwise the request
  is rejected with `403 FORBIDDEN`. An omitted/empty list allows all functions
  (backward-compatible).
- **Use case:** keep sensitive functions (e.g. `ID_VERIFICATION`) off API keys that
  should not touch PII, without a redeploy — the scope lives in the tenant record.
- **Rate limiting.** Per-tenant fixed-window counter in Redis, keyed on `tenantId`
  (falling back to client IP). Default `RATE_LIMIT_MAX` requests per
  `RATE_LIMIT_WINDOW_SECONDS` (defaults: 60 per 60 s), overridable per tenant.
  Exhaustion returns `429 RATE_LIMITED` (retryable). The limiter is **fail-open**: if
  Redis is unreachable it logs a warning and allows the request, so it never becomes the
  outage it exists to prevent.

> Note the deliberate asymmetry: **authentication fails closed** (a broken security
> control must not admit traffic) while **rate limiting fails open** (a broken
> availability control must not deny traffic).

- **CORS.** Default-closed. The service is server-to-server; browser origins are not
  accepted unless explicitly configured (`CORS_ALLOWED_ORIGINS`, or per-tenant
  `allowedOrigins` when a first-party dashboard is introduced).

---

## Error Handling and Status Codes

All errors are returned as a single uniform envelope. A raw provider or internal error
is never surfaced; every error is mapped to a typed code that callers can switch on.

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

`retryable` tells the caller whether a straight retry may succeed. `details` is optional
and, when present, carries structured validation issues.

**Codes and HTTP status:**

| Code                       | HTTP | Retryable | When                                                         |
| -------------------------- | ---- | --------- | ------------------------------------------------------------ |
| `UNAUTHORIZED`             | 401  | no        | Missing, invalid, or revoked API key.                        |
| `FORBIDDEN`                | 403  | no        | Key not authorized for the requested function.               |
| `INVALID_ARGS`             | 400  | no        | Unknown function, missing file, or bad `args`.               |
| `FILE_TOO_LARGE`           | 413  | no        | Upload exceeds `MAX_FILE_SIZE_BYTES`.                        |
| `UNSUPPORTED_MEDIA_TYPE`   | 415  | no        | Sniffed type unsupported or not in the function's `accepts`. |
| `PAGE_LIMIT_EXCEEDED`      | 422  | no        | Document exceeds the function's `maxPages`.                  |
| `NO_TEXT_DETECTED`         | 422  | no        | Extraction produced no usable text.                          |
| `SCHEMA_VALIDATION_FAILED` | 422  | no        | Function output failed its result schema/business rules.     |
| `RATE_LIMITED`             | 429  | yes       | Per-tenant rate limit exceeded.                              |
| `EXTRACTION_FAILED`        | 502  | yes       | All providers in the fallback chain failed.                  |
| `INTERPRETATION_FAILED`    | 502  | no        | The function's execute/LLM step failed.                      |
| `PROVIDER_UNAVAILABLE`     | 503  | yes       | Auth store or a required provider is unreachable.            |

**Fallback behaviour.** During extraction, if the primary provider errors, the service
tries each configured fallback in turn. A successful fallback stamps `meta.fellBackFrom`
with the primary provider's name; only if the entire chain fails is `EXTRACTION_FAILED`
returned.

---

## Testing and Validation

> **Current state:** no automated test suite is wired (`npm test` is a placeholder). The
> following is the validation strategy this specification mandates for the service to be
> considered production-ready.

**Structural guarantees already enforced by the code (validate these hold):**

- **Args validation.** Every request's `args` is parsed against the function's Zod
  schema; invalid args yield `INVALID_ARGS` with structured `details` before any work is
  done.
- **Result validation.** Every function's output is validated against its Zod result
  schema (static or, for `FORM_DATA_EXTRACTION`, dynamically derived from args) before
  it is returned; a non-conforming result yields `SCHEMA_VALIDATION_FAILED` rather than
  leaking a malformed body.
- **Input bounds.** `FORM_DATA_EXTRACTION` caller schemas are bounded on field count
  (≤ 50), nesting depth (≤ 3), and serialized size (≤ 20 000 bytes) to cap prompt-size /
  DoS surface.
- **Type sniffing.** The magic-byte sniffer must reject binaries masquerading as text
  (NUL bytes, non-UTF-8, > 10% control chars).

**Test coverage to build (by layer):**

| Layer         | Focus                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ingest        | Sniffer accepts pdf/image/docx/text; rejects mislabeled and unsupported binaries; size cap.                                                       |
| Providers     | Each provider emits a well-formed `RecognizedDocument`; fallback chain triggers and stamps `fellBackFrom`.                                        |
| Functions     | Args → result golden fixtures per function; business rules (e.g. receipt total reconciliation → `confidence`, MRZ checksum in `ID_VERIFICATION`). |
| Security      | Fail-closed auth on store outage; fail-open rate limiter; `authorizeFunction` scoping; `no-store` + no-cache for `pii`.                           |
| HTTP contract | Success/error envelope shape; every `OcrErrorCode` maps to the documented status.                                                                 |
| Pipeline      | End-to-end sync path; `maxPages` and `accepts` enforcement; cache used only for `standard`.                                                       |

**Validation environments.** LLM functions require Azure OpenAI configured
(`AZURE_OPENAI_ENABLED=true`); tests for LLM functions should mock the `LlmClient` so
they run deterministically without a live deployment.

---

## Glossary

| Term                     | Definition                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Function**             | A named interpretation task (e.g. `RECEIPT_PARSING`) selected via the URL path.                                                                                       |
| **Capability**           | A skill a provider offers (`text`, `layout`, `tables`, `handwriting`, `seals`); a function declares which it `requires`.                                              |
| **`RecognizedDocument`** | The canonical extraction output (markdown, plain text, pages, layout blocks) every provider returns; the single contract the interpretation layer is written against. |
| **Provider**             | An extraction engine (pdf-parse, Mammoth, Tesseract, GLM-OCR, plain-text) that produces a `RecognizedDocument`.                                                       |
| **Fallback chain**       | The ordered list of providers tried on error before an extraction is declared failed.                                                                                 |
| **Tenant**               | The identity resolved from an API key; scopes authorization, rate limiting, and caching.                                                                              |
| **Sensitivity**          | A per-function classification (`standard` / `pii` / `restricted`) that centrally drives logging, caching, and cache-control policy.                                   |
| **MRZ**                  | Machine-Readable Zone — the checksum-bearing text band on passports/IDs, parsed and verified by `ID_VERIFICATION`.                                                    |
| **Sniff**                | Determining a file's true type from its magic bytes rather than the client-supplied name/MIME.                                                                        |
| **Structured output**    | Azure OpenAI generation constrained to a JSON Schema derived from the function's Zod result schema.                                                                   |
