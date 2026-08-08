# Code Review — heirs-ocr

**Reviewer stance:** blunt, no participation trophies. Nothing below ships to prod.
**Date:** 2026-08-08 · **Branch:** `feature/ocr` · **Verified:** 86/86 tests pass, repo builds.

---

## Remediation status (2026-08-08)

| # | Issue | Status |
|---|-------|--------|
| P0#1 | Admin login brute-force throttle + password policy | ✅ Fixed |
| P0#2 | Failed-login logging | ✅ Fixed |
| P0#3 | `/metrics` unauthenticated | ✅ Fixed (bearer-token guard + prod boot warning) |
| P0#4 | No security headers / clickjacking | ✅ Fixed (CSP, X-Frame-Options, HSTS middleware) |
| P1#5 | Invalid-key DB spray | ✅ Fixed (negative auth caching) |
| P1#6 | Rate limiter fully fail-open | ✅ Fixed (in-process fallback) |
| P1#7 | Prod can disable auth/rate-limit | ✅ Fixed (env `refine` guards) |
| P1#8 | Internal 500s mislabeled retryable | ✅ Fixed (`INTERNAL` code) |
| P2#10 | ESLint installed, never run | ✅ Fixed (removed dead dep) |
| P2#11 | Package metadata / dishonest `1.0.0` | ✅ Fixed (`0.9.0`, `private`, metadata) |
| P2#12 | `morgan("dev")` in prod | ✅ Fixed (`combined` in prod) |
| P2#9 | 5 MB `eng.traineddata` in git | ⏳ Deferred — needs a history rewrite (destructive); awaiting go-ahead |
| P2#13 | Thin per-function integration coverage | ⏳ Deferred — needs live vendor credentials |

Verification after fixes: `tsc --noEmit` clean · 86/86 tests pass · prettier clean.

---

## Verdict

The engineering here is genuinely good — layered, documented, typed, fail-closed where
it counts. So I'm not going to insult you with generic "add more tests" filler. I'm going
to tell you the specific places where this codebase writes a check its `"version": "1.0.0"`
can't cash.

**This is not 1.0.0. It's a strong 0.8 wearing a production label.** Your own `TODO.md`
admits it: zero live-vendor validation, zero per-function integration coverage, decision
record still `status: draft`. Stamping `1.0.0` on `package.json` while the TODO says
"Blocking real (production) use" is either sloppiness or wishful thinking. Pick one and fix it.

The architecture will not embarrass you. The **operational security posture will**, because
several controls that *look* present are missing exactly where an attacker looks first.

---

## P0 — Blockers. Do not deploy internet-facing until these are closed.

### 1. Admin login has no brute-force protection
`src/http/admin/routes.ts:103` — `POST /api/login` runs `handler(...)` and nothing else.
No rate limiter, no lockout, no backoff. Compare that to `/v1/ocr/:function`
(`src/http/routes.ts:43`) which is wrapped in `rateLimit`. Your **most sensitive endpoint —
the one that mints owner-role sessions — is the one endpoint you left unthrottled.**

Argon2 (`verifyPassword`) slows each guess, but "slow" is not "throttled." Pair that with
`ADMIN_BOOTSTRAP_PASSWORD` coming from an env var (`src/config/env.ts:15`, a bare
`z.string()` with **no minimum length or complexity**) and you have an unthrottled online
guessing attack against a password whose strength you never enforced.

**Fix:** rate-limit `/api/login` per-IP and per-email, add exponential backoff or temporary
lockout, and enforce a real password policy on the bootstrap credential.

### 2. Failed admin logins are not logged
`src/http/admin/routes.ts:120` returns 401 on bad credentials and logs **nothing**. Only the
*success* path logs (`admin.login`, line 132). So the brute-force attack in P0#1 is also
**invisible** — no signal to alert on, no audit trail of the attempt. You cannot detect what
you refuse to record.

**Fix:** log every failed login (email, source IP, timestamp) at `warn`.

### 3. `/metrics` is unauthenticated on the public app
`src/main.ts:31` mounts Prometheus `/metrics` with no auth, on the **same Express app and
port** as your public OCR routes. The comment says "keep it on an internal network" — a
comment is not a network boundary. If this process is reachable from the internet (and a
public OCR API generally is), you're handing out request volumes, per-function traffic
shape, error rates, and queue depth to anyone who curls the port.

**Fix:** put `/metrics` behind auth, or bind it to a separate internal-only port. Don't rely
on a hope written in a code comment.

### 4. No security headers. The admin console is clickjackable.
`src/main.ts` — there is **no `helmet`, no CSP, no `X-Frame-Options`, no
`X-Content-Type-Options`, no HSTS.** You serve an authenticated admin UI out of
`public/admin` (`src/main.ts:41`) from the same app, over cookies, with **zero framing
protection.** SameSite=strict on the session cookie is your *only* CSRF mitigation, and it's
carrying the entire weight alone with no defense-in-depth behind it.

**Fix:** add `helmet` with a real CSP for `/admin`, set `X-Frame-Options: DENY`, and stop
leaning on one cookie attribute as your complete browser-security story.

---

## P1 — Serious. These are landmines, not blockers.

### 5. Invalid-API-key spray hits Postgres on every request (DoS amplification)
`src/auth/tenants.ts:85` caches **positive** lookups only. On a cache miss it deletes the
key and returns `undefined` (`:92`) — **negative results are never cached.** Now look at
middleware order in `src/http/routes.ts:43`: `auth` runs *before* `rateLimit`. So an
unauthenticated attacker spraying random keys:

- never reaches the rate limiter (auth rejects first), and
- forces **one Postgres query per bogus request** (`getTenantByHash`, `:179`).

That's an unauthenticated request flood converting directly into database load, with your
own rate limiter positioned where it can't help. And because auth is fail-closed
(`src/http/middleware/auth.ts:45`), if the attacker succeeds in stressing Postgres, **every
legitimate tenant gets 503'd too.**

**Fix:** short-TTL negative caching for unknown key-hashes, and/or a cheap pre-auth
IP-based limiter in front of the DB lookup.

### 6. Rate limiter fails open and is single-keyed on a defeatable dependency
`src/http/middleware/rate-limit.ts:36` — if Redis is unreachable, it logs a warning and
**allows the request.** Combined with the fixed-window counter (`:43`, which already permits
2× burst across a window boundary), an attacker who can degrade Redis removes **all** rate
limiting service-wide. The fail-open choice is defensible in isolation, but you've built a
system where knocking over one dependency disarms the control that protects the others.

**Fix:** at minimum, keep an in-process fallback limiter so Redis loss degrades to
*something*, not to *nothing*.

### 7. `AUTH_ENABLED=false` is one typo away from an open API in production
`src/http/middleware/auth.ts:24` — when auth is disabled, every request becomes tenant
`"anonymous"` and sails through. The env schema (`src/config/env.ts:23`) happily accepts
`AUTH_ENABLED=false` **with `NODE_ENV=production`.** There is no guard tying these together.
The only thing standing between you and a wide-open production API is one operator not
fat-fingering an env var.

**Fix:** make the env schema `refine()` reject `AUTH_ENABLED=false` when
`NODE_ENV=production`. Same treatment for `RATE_LIMIT_ENABLED=false`.

### 8. Internal 500s are mislabeled as retryable extraction failures
`src/http/middleware/error.ts:32` — every unhandled error becomes
`code: "EXTRACTION_FAILED", retryable: true`. So a **deterministic server bug** (null deref,
bad cast, logic error) tells the client "sure, retry me." Well-behaved clients will then
hammer the exact request that's guaranteed to fail, turning one bug into a self-inflicted
retry storm. An internal error is `INTERNAL`, and it is **not** retryable.

**Fix:** add a distinct non-retryable `INTERNAL` code for the unknown-error branch.

---

## P2 — Sloppy. Fix before you call anything "1.0.0".

### 9. A 5 MB binary is committed to git
`eng.traineddata` is a **5.0 MB Tesseract model tracked in the repo.** Every clone drags it
forever, every mirror stores it, and it will never leave history without a rewrite. This
belongs in Git LFS or a build-time download step, not in `git log`.

### 10. ESLint is installed but never runs
`eslint@^10` sits in `devDependencies`, but `package.json`'s `lint` script is only
`prettier --check` + `tsc --noEmit`. You are paying for a linter you don't invoke. Either
wire it into `lint` and CI, or delete it — a dependency that does nothing is a lie about
your tooling.

### 11. Package metadata is abandoned-hackathon grade
`package.json`: empty `"description"`, empty `"author"`, `"license": "ISC"` on what looks
like proprietary work, and `"version": "1.0.0"` contradicting `TODO.md`. This is the first
thing anyone auditing the project sees. Fill it in and set an honest version (`0.x`) until
the TODO's launch-blockers are actually closed.

### 12. `morgan("dev")` in a service you intend to run in production
`src/main.ts:17` — the `dev` format is colorized, unstructured, and explicitly not meant for
production log pipelines. You built a structured redacting logger
(`observability/logger.ts`) and then bolted a dev-mode HTTP logger next to it. Pick the
structured one everywhere.

### 13. Test-to-source ratio is thin where risk is highest
1,417 test LOC against 6,657 source LOC (~21%), and your own TODO admits **no per-function
integration coverage** for eight functions including `ID_VERIFICATION` (PII) and `SIGNING`
(213 LOC in `execute.ts`, one of your largest, most consequential files). The 86 passing
tests are real, but they're concentrated on the seams, not the money paths.

---

## Credit where it's due (so you know I actually read it)

- **`src/pipeline.ts`** — clean stage separation, one orchestration path for sync and async,
  metrics labeled correctly even on the error path. This is the strongest file in the repo.
- **API-key handling** (`src/auth/tenants.ts`) — sha256 of a high-entropy token as the
  primary key, raw key never stored, hash-keyed lookups so you never string-compare a
  secret. Correct, and correctly *explained*.
- **Fail-closed auth** with short-TTL cache to ride out DB blips — right call, right reasons.
- **Sensitivity-aware pipeline** — redacting logger + disabled trace capture for PII
  functions, enforced at the single choke point (`pipeline.ts:101`). Good security design.
- **Session model** — opaque random tokens with re-check-on-resolve so revocation is
  immediate, not TTL-bound (`admin-session.ts:40`). Textbook.
- Documentation density is well above industry norm and mostly explains *why*, not *what*.

The instincts are right. The gaps are in the last mile — the operational hardening that
separates "works on my machine and in tests" from "survives contact with the internet."

---

## Do these in order

1. Throttle + log `/api/login` (P0#1, P0#2)
2. Lock down `/metrics` and add `helmet` (P0#3, P0#4)
3. Negative auth caching + reorder/pre-auth limiter (P1#5)
4. `refine()` the env schema so prod can't disable auth/rate-limit (P1#7)
5. Split `INTERNAL` from `EXTRACTION_FAILED` (P1#8)
6. Fix `package.json` metadata + honest version, move `eng.traineddata` to LFS (P2#9, P2#11)
7. Land the per-function integration tests your TODO already promised (P2#13)

Close P0 and P1 and this is a service I'd sign off on. Ship it as-is and the first pen test
writes this same document with worse language.
