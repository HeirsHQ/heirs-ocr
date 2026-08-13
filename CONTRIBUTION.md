# Contributing to Heirs OCR

How to set up, build, test, and extend the service — and the conventions to keep it coherent.
For the design, read [TECHNICAL.md](./TECHNICAL.md); for the contract, [API_SPEC.md](./API_SPEC.md).

## Prerequisites

- **Node 22+** and **pnpm** (`packageManager` pins `pnpm@11`; the repo enforces pnpm — see below).
- A **Redis** instance (extraction cache + BullMQ queue + rate limiter + sessions).
- A **Postgres** database (tenants, admins, tenant-users, usage, plans, subscriptions).
- Optional, to enable those paths: **Azure OpenAI** (interpretation) and **GLM-OCR** (layout OCR)
  credentials.

You can bring Redis + Postgres yourself, or start throwaway ones with
`docker compose --profile local-infra up`.

## pnpm only — never npm

> **This repo is pnpm-managed.** Running `npm install` corrupts the dependency tree; a
> `preinstall` guard (`scripts/ensure-pnpm.cjs`) blocks it. Always use `pnpm`.

If you hit `ERR_PNPM_UNEXPECTED_STORE` (e.g. after a Node/pnpm version bump), pass an explicit
store: `pnpm install --store-dir node_modules/.pnpm-store`.

## Setup

```bash
pnpm install
cp .env.example .env        # fill in REDIS_URL, DATABASE_URL (+ Azure/GLM keys to enable those)
pnpm dev                    # API (nodemon) + web (concurrently)
```

Other entrypoints:

```bash
pnpm dev:api                # backend only (nodemon)
pnpm build && pnpm start    # production build, then node build/index.js
pnpm worker                 # async queue worker (node build/worker.js)
```

The frontend is a self-contained pnpm workspace in `web/` (two apps — admin console + tenant
portal — sharing `packages/*`), run separately from the backend:

```bash
cd web && pnpm install && pnpm dev   # admin :3000, tenant :3001; both proxy to OCR_API_URL
```

The Postgres schema is created idempotently at startup; no migration step is needed. For local
work without auth, set `AUTH_ENABLED=false` (dev only — it throws at boot in production).

## Build, test, and verify

```bash
pnpm test                   # vitest run (the suite is the CI gate)
pnpm test:watch             # vitest watch
pnpm lint                   # prettier --check + tsc --noEmit
pnpm prettier:write         # auto-format
```

> **Verify with the direct binaries when the pnpm wrappers misbehave** in this environment
> (snap-node + the `preinstall` precheck can interfere). Run the tools straight from
> `node_modules/.bin/` instead:
>
> ```bash
> ./node_modules/.bin/tsc --noEmit
> ./node_modules/.bin/vitest run
> ./node_modules/.bin/prettier --check "src/**/*.{ts,md,json}"
> ```

Every change should leave `tsc --noEmit`, `vitest run`, and `prettier --check` green before it's
proposed for review.

## Testing conventions

- Tests live in `test/*.test.ts` (Vitest). There is roughly one spec per function plus specs for
  the pipeline, providers/router, auth/authorize, admin, jobs, cache, MRZ, and subscriptions.
- **Mock the `LlmClient`** for LLM-backed functions so tests run deterministically without a live
  Azure deployment (`test/support.ts` has the shared helpers).
- Prefer **golden fixtures** for args → result (`test/fixtures/`), and assert the deterministic
  business rules explicitly (e.g. receipt total reconciliation → `confidence`, MRZ checksum).
- Keep **pure decisions pure**: entitlements, pricing, MRZ, and reconciliation are side-effect
  free and take an explicit `now` where time matters — test them without Express or a database.

## Adding a function

1. Create `src/functions/<name>/` with `args.ts` (Zod), `result.ts` (Zod), and `execute.ts`; add
   `prompt.ts` if it uses the LLM and `validate.ts` for deterministic post-checks.
2. Declare it with `defineOcrFunction`, setting `accepts`, `requires` (capabilities),
   `sensitivity`, `maxPages`, and optionally `confidenceOf` (feeds the quality SLI). Set
   `skipExtraction: true` only for raw-bytes functions (like `DOCUMENT_AUTHENTICITY`).
3. Register it in `src/functions/registry.ts`. The catalog, JSON Schemas, routing, and the
   pipeline pick it up automatically.
4. Add a `test/<name>.test.ts` with golden fixtures and any business-rule assertions.
5. If it should be sellable, add it to the relevant plan(s) in `src/billing/plans.ts` (or leave it
   to the `STANDARD_FUNCTIONS` set). PII functions must sit above a plan's `standard` ceiling.

## House rules

These are the conventions the codebase already follows — match the surrounding code.

- **Functions decide; middleware does I/O.** Business logic returns a typed decision/result; the
  HTTP layer maps it to a status and does the database/Redis work.
- **Determinism over LLM where math suffices.** Never trust the model's arithmetic — recompute
  totals, checksums, and verdicts in code.
- **Sensitivity is declarative.** Set `sensitivity` on the function; never add a per-call PII
  flag. The pipeline enforces logging/caching/queueing policy centrally.
- **Config in env, validated at boot.** Add new config to `src/config/env.ts` (Zod) and document
  it in `.env.example`. No secrets in source; enabling a vendor without its key must fail fast.
- **Typed errors only.** Throw `OcrError` with a code from `src/http/errors.ts`; never surface a
  raw provider/internal error to the caller. Adding a code means updating [API_SPEC.md](./API_SPEC.md).
- **Additive, versioned contracts.** Treat any change to `/v1` error codes or the response
  envelope as a versioned change (bump API_SPEC and get owner sign-off).
- **Keep the GLM mapper defensive** — an unknown upstream `label`/shape must degrade, not 500.

## Web frontend

`web/` targets a Next.js version with **breaking changes vs. common training data**. Its
auto-generated `web/AGENTS.md` says to read `node_modules/next/dist/docs/` before writing web
code — heed it. That `AGENTS.md` block is re-written by `next dev`; commit it with your work
rather than fighting the diff.

## Commits & branches

- **Conventional Commits** (`feat:`, `fix:`, `feat(auth): …`, `docs:`), matching the existing
  history.
- Branch off `main` (or the active feature branch); don't commit straight to `main`.
- Only commit or push when asked. Co-author trailer for AI-assisted commits:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Decisions & docs

- **Significant, hard-to-reverse choices** (a new service dependency, an auth change, a vendor,
  an API-contract change) follow the decision framework in
  [TECHNICAL.md § Governance](./TECHNICAL.md#10-governance-decisions-ownership--cost): one-way-door →
  ADR + second opinion; cross-team → RFC; reversible/local → PR approval.
- **Keep the four docs in sync with the code.** Drift between docs and reality is the exact
  problem this set was consolidated to fix — if you change the contract, update
  [API_SPEC.md](./API_SPEC.md); if you change the design, update [TECHNICAL.md](./TECHNICAL.md);
  note user-facing changes in [CHANGELOG.md](./CHANGELOG.md).
