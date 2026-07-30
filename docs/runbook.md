# Ops Runbook — Heirs OCR Service

Operational reference for running the service in production: topology, config, health,
what the alerts mean, and how to respond when something breaks. Pairs with
[architecture.md](./architecture.md) (how it works) and
[vendor-threat-model.md](./vendor-threat-model.md) (vendor risk). Closes decision-record Q9.

> **Owner:** _unassigned — see [decision-record.md](./decision-record.md) § Plan, item 1._
> Fill this in before the record moves from `draft` → `accepted`.

## Topology

Two process types off **one image**, plus Redis. Both processes are stateless; all state
lives in Redis (extraction cache, job queue, rate-limit counters, tenant registry).

| Process  | Command                | Scales on         | Purpose                                 |
| -------- | ---------------------- | ----------------- | --------------------------------------- |
| `web`    | `node build/index.js`  | request rate      | HTTP API; runs the sync pipeline inline |
| `worker` | `node build/worker.js` | async job backlog | Drains the BullMQ queue off-request     |
| `redis`  | managed / `redis:7`    | —                 | Cache + queue + rate-limit + tenants    |

`docker-compose.yml` stands the whole topology up locally (`docker compose up --build`).

## Configuration

All config is env, Zod-validated at boot ([`src/config/env.ts`](../src/config/env.ts)) —
**invalid config throws on startup, so a bad deploy fails fast rather than half-running.**

| Var                                                                                    | Default                  | Notes                                                                     |
| -------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| `REDIS_URL`                                                                            | `redis://localhost:6379` | Required in prod. Single point of shared state.                           |
| `PORT`                                                                                 | `8080`                   | Web only.                                                                 |
| `AUTH_ENABLED`                                                                         | `true`                   | **Never `false` in prod** — disables API-key auth.                        |
| `RATE_LIMIT_ENABLED` / `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_SECONDS`                  | `true` / `60` / `60`     | Per-tenant fixed window.                                                  |
| `ASYNC_SIZE_THRESHOLD_BYTES` / `ASYNC_PAGE_THRESHOLD`                                  | `5 MiB` / `5`            | Above either → job is queued (202) instead of run inline.                 |
| `MAX_FILE_SIZE_BYTES`                                                                  | `50 MiB`                 | Hard upload cap (multer).                                                 |
| `AZURE_OPENAI_ENABLED` (+ `_API_KEY`, `_ENDPOINT`, `_API_VERSION`, `_DEPLOYMENT_NAME`) | `false`                  | Enabling without the key **throws at boot**. Needed by all LLM functions. |
| `GLM_ENABLED` (+ `_API_KEY`, `_BASE_URL`, `_MAX_PAGES`, `_CONCURRENCY`)                | `false`                  | `GLM_BASE_URL` can point at a self-hosted endpoint for data residency.    |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                                          | unset                    | Set → traces ship over OTLP/HTTP. Unset → spans created, not exported.    |

## Health, probes, and scrape endpoints

| Endpoint       | Auth | Use                                                                                                    |
| -------------- | ---- | ------------------------------------------------------------------------------------------------------ |
| `GET /healthz` | none | Liveness. Returns `{status:"ok"}` if the process is up.                                                |
| `GET /readyz`  | none | Readiness. **⚠️ Currently a static `ok` — it does _not_ yet probe Redis / vendors.** See _Known gaps_. |
| `GET /metrics` | none | Prometheus scrape. No tenant data in labels — **keep on an internal network.**                         |

Probes and `/metrics` are unauthenticated by design; do not expose them publicly.

## Key metrics & suggested alerts

Series live in [`src/observability/metrics.ts`](../src/observability/metrics.ts).

| Signal                      | Series                                                                                | Alert when                                      |
| --------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Error rate                  | `ocr_requests_total{outcome="error"}` / total                                         | > 5% over 5m                                    |
| Provider fallbacks          | `ocr_provider_fallback_total`                                                         | Sustained rise ⇒ a primary provider is degraded |
| Extract / interpret latency | `ocr_extract_duration_ms`, `ocr_interpret_duration_ms` (histograms, **success-only**) | p95 breaches SLO                                |
| LLM spend                   | `ocr_tokens_used_total`                                                               | Unexpected spike ⇒ runaway usage/abuse          |
| Job backlog                 | BullMQ `waiting` depth (Redis)                                                        | Grows unbounded ⇒ worker stalled/down           |

Note: latency/page histograms observe **successful** requests only, so a latency graph
won't be skewed by fast failures. Failures still increment `ocr_requests_total{outcome="error"}`.

## Common failures → remediation

The API never leaks a raw provider error; every failure is a typed code
([`src/http/errors.ts`](../src/http/errors.ts)). Map the code to the cause:

| Code (HTTP)                                        | Likely cause                                                                                     | Action                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `INTERPRETATION_FAILED` (502)                      | Azure OpenAI down/misconfigured, or `AZURE_OPENAI_ENABLED=false` while an LLM function is called | Check Azure status + config; confirm deployment name. Non-LLM functions (`TEXT_EXTRACTION`, `DOCUMENT_AUTHENTICITY`) are unaffected. |
| `EXTRACTION_FAILED` (502)                          | Every provider in the chain failed (e.g. corrupt file, GLM + Tesseract both erroring)            | Check provider health / fallback metric; retry; inspect the input.                                                                   |
| `PROVIDER_UNAVAILABLE` (503)                       | Enqueue failed → **Redis unreachable**, or a provider timed out                                  | Check Redis connectivity first. Retryable.                                                                                           |
| `RATE_LIMITED` (429)                               | Tenant over its window                                                                           | Expected; raise the tenant's `--rate` if legitimate.                                                                                 |
| `UNAUTHORIZED` / `FORBIDDEN` (401/403)             | Bad/revoked key, or key not scoped to the function                                               | Verify with `provision:tenant list`; re-provision if needed.                                                                         |
| `PAGE_LIMIT_EXCEEDED` / `FILE_TOO_LARGE` (422/413) | Input exceeds function `maxPages` / `MAX_FILE_SIZE_BYTES`                                        | Caller-side; adjust limits only deliberately.                                                                                        |

### Redis is down

Redis is load-bearing: no cache, no queue, no rate-limit, no tenant lookups. Symptoms:
`PROVIDER_UNAVAILABLE` on enqueue, `UNAUTHORIZED` if the tenant cache is cold, rate-limit
failing (fails **closed** — the limiter client is configured to fail fast). The extraction
cache **fails open** (a cache outage degrades to recompute, not an error). Restore Redis;
processes reconnect without a redeploy.

### Worker stalled / job backlog growing

Jobs enqueue but `waiting` depth climbs. Check the worker process is up and logging
`job completed`; check its Redis connection. Restart the worker (`node build/worker.js`);
in-flight jobs are safe — BullMQ redelivers. A failed job keeps a typed code recoverable
via `GET /v1/ocr/jobs/:id` (`encodeJobError`).

## Deploy, shutdown, rollback

- **Graceful shutdown (both entrypoints):** on `SIGTERM`/`SIGINT` the web server stops
  accepting connections, drains in-flight requests, flushes traces, and closes Redis, with
  a **10s forced-exit fallback**. The worker drains its active jobs. Rolling deploys don't
  cut in-flight work. _(12-factor IX.)_
- **Rollback:** processes are stateless and config-driven with no destructive migrations —
  redeploy the prior image. Redis is a cache/registry, not a system of record, so a rollback
  loses no durable data. Re-check that any changed env var is reverted too.

## Tenant management (admin)

Runtime, no redeploy ([`src/scripts/provision-tenant.ts`](../src/scripts/provision-tenant.ts)):

```
pnpm provision:tenant create <tenantId> [--rate N] [--functions A,B] [--origins a,b] [--actor who]
pnpm provision:tenant list
pnpm provision:tenant revoke <apiKey> [--actor who]
```

- `create` prints the raw key **once** — only its sha256 is stored; it cannot be recovered.
- `create`/`revoke` emit a `tenant.provisioned` / `tenant.revoked` **audit line** to stdout
  (there is no DB — the log stream is the audit trail). Tag the operator with `--actor`.
- To lock a compromised key: `revoke` it; the auth cache TTL (`API_KEY_CACHE_TTL_SECONDS`,
  default 30s) bounds how long it stays valid after revocation.

## Known gaps (as of this writing)

- **`/readyz` is a stub** — it returns `ok` unconditionally and does not verify Redis or
  vendor reachability. A pod can be marked Ready while Redis is unreachable. _Fix: probe
  `redis.ping()` (and optionally a cheap vendor check) before this gates real traffic._
- **`recordConfidence` and the estimated-cost counter are unfed** — no confidence/cost SLI
  yet; the `ocr_confidence_observations_total` / `ocr_estimated_cost_ngn_total` series exist
  but stay at zero until a function emits those signals.
