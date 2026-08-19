import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

/**
 * Backing stores for the units under test, built in vi.hoisted so they exist
 * before the hoisted vi.mock factories run:
 *
 *  - `query` runs real SQL against an in-memory Postgres (pg-mem) — the durable
 *    stores (admins, tenants, usage) exercise their actual statements with no
 *    external database, so `pnpm test` stays self-contained.
 *  - `fakeRedis` keeps just enough string semantics for admin sessions, which
 *    still live in Redis.
 */
const { query, ensureSchema, resetDb, fakeRedis, strings, sets } = vi.hoisted(() => {
  // require (not import) so this runs inside the hoisted factory.
  const { newDb } = require("pg-mem") as typeof import("pg-mem");

  const DDL = `
    CREATE TABLE IF NOT EXISTS tenants (
      key_hash text PRIMARY KEY,
      tenant_id text NOT NULL,
      name text,
      disabled boolean NOT NULL DEFAULT false,
      rate_limit integer,
      allowed_origins jsonb,
      allowed_functions jsonb,
      expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS admins (
      id uuid PRIMARY KEY,
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      role text NOT NULL,
      password_hash text NOT NULL,
      disabled boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tenant_usage (
      tenant_id text PRIMARY KEY,
      requests bigint NOT NULL DEFAULT 0,
      errors bigint NOT NULL DEFAULT 0,
      tokens bigint NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS function_usage (
      function_key text PRIMARY KEY,
      requests bigint NOT NULL DEFAULT 0,
      errors bigint NOT NULL DEFAULT 0,
      tokens bigint NOT NULL DEFAULT 0,
      confidence_observations bigint NOT NULL DEFAULT 0,
      low_confidence bigint NOT NULL DEFAULT 0,
      fallbacks bigint NOT NULL DEFAULT 0
    );
  `;

  let mem = newDb();
  let pool = new (mem.adapters.createPg().Pool)();

  const query = vi.fn((text: string, params?: unknown[]) => pool.query(text, params));
  const ensureSchema = async () => {
    mem.public.none(DDL);
  };
  const resetDb = async () => {
    mem = newDb();
    pool = new (mem.adapters.createPg().Pool)();
    mem.public.none(DDL);
    query.mockReset();
    query.mockImplementation((text: string, params?: unknown[]) => pool.query(text, params));
  };

  const strings = new Map<string, string>();
  // Sets back the per-user session index (src/auth/session-store.ts), which is what
  // makes "list my sessions" and "revoke the others" possible at all.
  const sets = new Map<string, Set<string>>();
  const fakeRedis = {
    get: vi.fn(async (key: string) => strings.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      strings.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (...keys: string[]) => keys.filter((k) => strings.delete(k)).length),
    sadd: vi.fn(async (key: string, ...members: string[]) => {
      const set = sets.get(key) ?? new Set<string>();
      members.forEach((m) => set.add(m));
      sets.set(key, set);
      return members.length;
    }),
    smembers: vi.fn(async (key: string) => [...(sets.get(key) ?? [])]),
    srem: vi.fn(async (key: string, ...members: string[]) => {
      const set = sets.get(key);
      if (!set) return 0;
      return members.filter((m) => set.delete(m)).length;
    }),
    expire: vi.fn(async () => 1),
    ping: vi.fn(async () => "PONG"),
  };

  return { query, ensureSchema, resetDb, fakeRedis, strings, sets };
});

vi.mock("../src/db", () => ({ query, ensureSchema, whenDbReady: async () => {}, closeDb: async () => {} }));
vi.mock("../src/redis", () => ({ getRedis: () => fakeRedis, whenRedisReady: async () => {} }));

import {
  countOwners,
  createAdmin,
  deleteAdmin,
  ensureBootstrapAdmin,
  getAdminByEmail,
  listAdmins,
  updateAdmin,
  verifyPassword,
} from "../src/auth/admins";
import {
  getTenantByHash,
  hashApiKey,
  listKeysForTenant,
  putTenant,
  revokeByHash,
  updateTenantByHash,
} from "../src/auth/tenants";
import { adminAuth, parseCookies, requireMinRole } from "../src/http/middleware/admin-auth";
import {
  createSession,
  destroySession,
  listSessions,
  resolveSession,
  revokeOtherSessions,
} from "../src/auth/admin-session";
import {
  getAllFunctionUsage,
  getAllTenantUsage,
  getTenantUsage,
  recordFunctionUsage,
  recordTenantUsage,
} from "../src/observability/usage";
import { getMetricsSummary } from "../src/observability/metrics";
import { runPipeline, type OcrRequest, type PipelineDeps } from "../src/pipeline";
import { textExtraction } from "../src/functions/text-extraction";
import { PlainTextProvider } from "../src/providers/plain-text";
import { MockLlmClient } from "../src/llm/azure";
import { defaultProviderPolicy } from "../src/config/providers";
import { noopCache } from "../src/cache";
import { logger } from "../src/observability/logger";

const reset = async () => {
  await resetDb();
  strings.clear();
  sets.clear();
};

describe("admin registry", () => {
  beforeEach(reset);

  it("creates, looks up, and verifies a password (never stores plaintext)", async () => {
    const view = await createAdmin({ email: "A@x.com", name: "A", role: "owner", password: "secret123" });
    expect(view).not.toHaveProperty("passwordHash");
    expect(view.email).toBe("a@x.com"); // normalized

    const record = await getAdminByEmail("a@x.com");
    expect(record).toBeDefined();
    expect(record!.passwordHash).not.toContain("secret123");
    expect(await verifyPassword(record!, "secret123")).toBe(true);
    expect(await verifyPassword(record!, "wrong")).toBe(false);
  });

  it("rejects a duplicate email", async () => {
    await createAdmin({ email: "dup@x.com", name: "D", role: "viewer", password: "secret123" });
    await expect(
      createAdmin({ email: "dup@x.com", name: "D2", role: "viewer", password: "secret123" }),
    ).rejects.toThrow(/already exists/);
  });

  it("listAdmins omits the password hash", async () => {
    await createAdmin({ email: "l@x.com", name: "L", role: "manager", password: "secret123" });
    const admins = await listAdmins();
    expect(admins).toHaveLength(1);
    expect(admins[0]).not.toHaveProperty("passwordHash");
  });

  it("verifyPassword fails for a disabled account even with the right password", async () => {
    const view = await createAdmin({ email: "d@x.com", name: "D", role: "viewer", password: "secret123" });
    await updateAdmin(view.id, { disabled: true });
    const record = await getAdminByEmail("d@x.com");
    expect(await verifyPassword(record!, "secret123")).toBe(false);
  });

  it("updateAdmin can reset the password and change role; deleteAdmin removes it", async () => {
    const view = await createAdmin({ email: "u@x.com", name: "U", role: "viewer", password: "secret123" });
    await updateAdmin(view.id, { role: "owner", password: "newpass123" });
    const record = await getAdminByEmail("u@x.com");
    expect(record!.role).toBe("owner");
    expect(await verifyPassword(record!, "newpass123")).toBe(true);

    expect(await deleteAdmin(view.id)).toBe(true);
    expect(await getAdminByEmail("u@x.com")).toBeUndefined();
  });

  it("countOwners counts only active owners", async () => {
    await createAdmin({ email: "o1@x.com", name: "O1", role: "owner", password: "secret123" });
    const o2 = await createAdmin({ email: "o2@x.com", name: "O2", role: "owner", password: "secret123" });
    await createAdmin({ email: "m@x.com", name: "M", role: "manager", password: "secret123" });
    expect(await countOwners()).toBe(2);
    await updateAdmin(o2.id, { disabled: true });
    expect(await countOwners()).toBe(1);
  });

  it("ensureBootstrapAdmin seeds one owner when empty, and is a no-op otherwise", async () => {
    await ensureBootstrapAdmin();
    const seeded = await listAdmins();
    expect(seeded).toHaveLength(1);
    expect(seeded[0]!.role).toBe("owner");

    // Idempotent: a second call must not add or overwrite anything.
    await ensureBootstrapAdmin();
    expect(await listAdmins()).toHaveLength(1);
  });
});

describe("admin sessions", () => {
  beforeEach(reset);

  it("resolves a live session to the admin's current role", async () => {
    const admin = await createAdmin({ email: "s@x.com", name: "S", role: "manager", password: "secret123" });
    const { token } = await createSession(admin.id, "manager");
    const session = await resolveSession(token);
    // `label` rides along for the audit trail — resolved from the record already
    // read to re-check the account is live, so it costs no extra query.
    expect(session).toEqual({ userId: admin.id, role: "manager", label: "S (s@x.com)" });
  });

  it("returns undefined for an unknown token and after destroy", async () => {
    expect(await resolveSession("nope")).toBeUndefined();
    const admin = await createAdmin({ email: "s2@x.com", name: "S", role: "viewer", password: "secret123" });
    const { token } = await createSession(admin.id, "viewer");
    await destroySession(token);
    expect(await resolveSession(token)).toBeUndefined();
  });

  it("returns undefined when the underlying admin is disabled", async () => {
    const admin = await createAdmin({ email: "s3@x.com", name: "S", role: "owner", password: "secret123" });
    const { token } = await createSession(admin.id, "owner");
    await updateAdmin(admin.id, { disabled: true });
    expect(await resolveSession(token)).toBeUndefined();
  });
});

describe("session index — list and revoke", () => {
  beforeEach(reset);

  const seed = () => createAdmin({ email: "s@x.com", name: "S", role: "owner", password: "secret123" });

  it("lists every live session for the account, marking the current one", async () => {
    const admin = await seed();
    const a = await createSession(admin.id, "owner", { ip: "1.1.1.1", userAgent: "Firefox" });
    await createSession(admin.id, "owner", { ip: "2.2.2.2", userAgent: "Safari" });

    const sessions = await listSessions(admin.id, a.token);
    expect(sessions).toHaveLength(2);
    // The caller's own session leads, so they can recognise it before revoking.
    expect(sessions[0]!.current).toBe(true);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(sessions.map((s) => s.ip).sort()).toEqual(["1.1.1.1", "2.2.2.2"]);
  });

  it("never returns the token itself", async () => {
    const admin = await seed();
    const { token } = await createSession(admin.id, "owner");

    const [session] = await listSessions(admin.id, token);
    // The id is a short prefix — enough to tell rows apart, useless for authenticating.
    expect(session!.id).not.toBe(token);
    expect(token.startsWith(session!.id)).toBe(true);
    expect(JSON.stringify(session)).not.toContain(token);
  });

  it("scopes the list to one account", async () => {
    const a = await seed();
    const b = await createAdmin({ email: "b@x.com", name: "B", role: "viewer", password: "secret123" });
    await createSession(a.id, "owner");
    await createSession(b.id, "viewer");

    expect(await listSessions(a.id)).toHaveLength(1);
    expect(await listSessions(b.id)).toHaveLength(1);
  });

  it("revokes every other session but leaves the caller signed in", async () => {
    const admin = await seed();
    const keep = await createSession(admin.id, "owner");
    const gone = await createSession(admin.id, "owner");
    const alsoGone = await createSession(admin.id, "owner");

    expect(await revokeOtherSessions(admin.id, keep.token)).toBe(2);
    expect(await resolveSession(keep.token)).toBeDefined();
    expect(await resolveSession(gone.token)).toBeUndefined();
    expect(await resolveSession(alsoGone.token)).toBeUndefined();
    expect(await listSessions(admin.id, keep.token)).toHaveLength(1);
  });

  it("revoking with no other sessions is a no-op, not an error", async () => {
    const admin = await seed();
    const only = await createSession(admin.id, "owner");
    expect(await revokeOtherSessions(admin.id, only.token)).toBe(0);
    expect(await resolveSession(only.token)).toBeDefined();
  });

  it("drops index entries whose session has expired", async () => {
    const admin = await seed();
    const { token } = await createSession(admin.id, "owner");
    // Simulate the session key ageing out while its index entry survives.
    strings.delete(`admin_session:${token}`);

    expect(await listSessions(admin.id)).toHaveLength(0);
    // Self-healing: the tombstone is removed rather than accumulating in the set.
    expect(await fakeRedis.smembers(`admin_session:index:${admin.id}`)).toEqual([]);
  });

  it("logout removes the session from the index too", async () => {
    const admin = await seed();
    const { token } = await createSession(admin.id, "owner");
    await destroySession(token);

    expect(await listSessions(admin.id)).toHaveLength(0);
    expect(await fakeRedis.smembers(`admin_session:index:${admin.id}`)).toEqual([]);
  });
});

describe("admin auth middleware", () => {
  beforeEach(reset);

  const makeRes = () => {
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return res as unknown as Response & { statusCode: number; body: any };
  };

  it("parseCookies splits a header into name/value pairs", () => {
    expect(parseCookies("a=1; admin_session=xyz; b=2")).toMatchObject({ a: "1", admin_session: "xyz", b: "2" });
    expect(parseCookies(undefined)).toEqual({});
  });

  it("rejects a request with no session cookie", async () => {
    const res = makeRes();
    const next = vi.fn();
    await adminAuth({ headers: {} } as Request, res, next as unknown as NextFunction);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches req.admin for a valid session", async () => {
    const admin = await createAdmin({ email: "auth@x.com", name: "A", role: "manager", password: "secret123" });
    const { token } = await createSession(admin.id, "manager");
    const req = { headers: { cookie: `admin_session=${token}` } } as Request;
    const next = vi.fn();
    await adminAuth(req, makeRes(), next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(req.admin).toEqual({ userId: admin.id, role: "manager", label: "A (auth@x.com)" });
  });

  it("requireMinRole 403s below the required tier and passes at/above it", () => {
    const guard = requireMinRole("manager");

    const low = makeRes();
    const nextLow = vi.fn();
    guard({ admin: { userId: "1", role: "viewer" } } as Request, low, nextLow as unknown as NextFunction);
    expect(low.statusCode).toBe(403);
    expect(nextLow).not.toHaveBeenCalled();

    const okNext = vi.fn();
    guard({ admin: { userId: "1", role: "owner" } } as Request, makeRes(), okNext as unknown as NextFunction);
    expect(okNext).toHaveBeenCalled();
  });
});

describe("tenant by-hash mutators", () => {
  beforeEach(reset);

  it("updateTenantByHash merges the patch and leaves other fields intact", async () => {
    const apiKey = "raw-key";
    await putTenant(apiKey, { tenantId: "acme", rateLimit: 10 });
    const keyHash = hashApiKey(apiKey);

    const updated = await updateTenantByHash(keyHash, { disabled: true });
    expect(updated).toBeDefined();
    expect(updated!.disabled).toBe(true);
    expect(updated!.tenantId).toBe("acme");
    expect(updated!.rateLimit).toBe(10);
  });

  it("updateTenantByHash returns undefined for an unknown hash", async () => {
    expect(await updateTenantByHash("deadbeef", { disabled: true })).toBeUndefined();
  });

  it("revokeByHash removes the tenant", async () => {
    const apiKey = "raw-key-2";
    await putTenant(apiKey, { tenantId: "beta" });
    const keyHash = hashApiKey(apiKey);
    expect(await revokeByHash(keyHash)).toBe(1);
    expect(await getTenantByHash(keyHash)).toBeUndefined();
  });
});

describe("tenant id uniqueness", () => {
  beforeEach(reset);

  // The table is keyed by key-hash, so the schema alone happily accepts a second
  // org under an existing `tenantId` — the two would then share usage, subscription,
  // and portal users. `listKeysForTenant(...).length > 0` is the predicate the admin
  // create route guards on (src/http/admin/routes.ts); these pin its two answers.
  it("listKeysForTenant is empty for an unused tenant id", async () => {
    expect(await listKeysForTenant("unused")).toEqual([]);
  });

  it("listKeysForTenant reports every key an existing tenant holds", async () => {
    await putTenant("key-a", { tenantId: "acme" });
    await putTenant("key-b", { tenantId: "acme" });

    const keys = await listKeysForTenant("acme");
    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.keyHash).sort()).toEqual([hashApiKey("key-a"), hashApiKey("key-b")].sort());
  });
});

describe("per-tenant usage", () => {
  beforeEach(reset);

  it("counts requests, errors, and tokens per tenant", async () => {
    recordTenantUsage("t1", { outcome: "success", tokensUsed: 100 });
    recordTenantUsage("t1", { outcome: "error", tokensUsed: 50 });
    recordTenantUsage("t2", { outcome: "success" });
    // Fire-and-forget: let the microtask queue drain.
    await new Promise((r) => setTimeout(r, 0));

    const usage = await getAllTenantUsage();
    const t1 = usage.find((u) => u.tenantId === "t1")!;
    expect(t1).toMatchObject({ requests: 2, errors: 1, tokens: 150 });
    const t2 = usage.find((u) => u.tenantId === "t2")!;
    expect(t2).toMatchObject({ requests: 1, errors: 0, tokens: 0 });
    await expect(getTenantUsage("t1")).resolves.toMatchObject({ requests: 2, errors: 1, tokens: 150 });
    await expect(getTenantUsage("missing")).resolves.toMatchObject({ requests: 0, errors: 0, tokens: 0 });
  });

  it("never throws when the database rejects", async () => {
    query.mockRejectedValueOnce(new Error("postgres down"));
    expect(() => recordTenantUsage("t3", { outcome: "success" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("records OCR pipeline usage under the request tenant id used by in-app sessions", async () => {
    const deps: PipelineDeps = {
      llm: new MockLlmClient(),
      logger,
      providers: [new PlainTextProvider()],
      cache: noopCache,
      policy: defaultProviderPolicy,
    };
    const request: OcrRequest = {
      file: { buffer: Buffer.from("portal document"), originalName: "doc.txt" },
      args: {},
      requestId: "req_portal_usage",
      tenantId: "tenant_portal",
    };

    await runPipeline(textExtraction, request, deps);
    await new Promise((r) => setTimeout(r, 0));

    await expect(getTenantUsage("tenant_portal")).resolves.toMatchObject({ requests: 1, errors: 0 });
    // Same run, second rollup: the console's per-function panel must see in-app
    // traffic too, not just direct API-key calls.
    const byFunction = await getAllFunctionUsage();
    expect(byFunction.find((f) => f.function === "TEXT_EXTRACTION")).toMatchObject({ requests: 1, errors: 0 });
  });
});

describe("per-function usage", () => {
  beforeEach(reset);

  /** Fire-and-forget writes: let the microtask queue drain before reading back. */
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("counts requests, errors, tokens, and fallbacks per function", async () => {
    recordFunctionUsage("RECEIPT_PARSING", { outcome: "success", tokensUsed: 100 });
    recordFunctionUsage("RECEIPT_PARSING", { outcome: "error", tokensUsed: 50, fellBack: true });
    recordFunctionUsage("RESUME_PARSING", { outcome: "success" });
    await settle();

    const usage = await getAllFunctionUsage();
    expect(usage.find((u) => u.function === "RECEIPT_PARSING")).toMatchObject({
      requests: 2,
      errors: 1,
      tokens: 150,
      fallbacks: 1,
    });
    expect(usage.find((u) => u.function === "RESUME_PARSING")).toMatchObject({ requests: 1, errors: 0, fallbacks: 0 });
    // Busiest first, so the console's table needs no sort of its own.
    expect(usage[0]!.function).toBe("RECEIPT_PARSING");
  });

  it("only counts a confidence observation when the function scored one", async () => {
    recordFunctionUsage("ID_VERIFICATION", { outcome: "success", lowConfidence: true });
    recordFunctionUsage("ID_VERIFICATION", { outcome: "success", lowConfidence: false });
    // No confidence signal at all (and the error path never scores one) — neither
    // may enter the denominator, or every ratio drifts toward zero.
    recordFunctionUsage("ID_VERIFICATION", { outcome: "success" });
    recordFunctionUsage("ID_VERIFICATION", { outcome: "error" });
    await settle();

    const [usage] = await getAllFunctionUsage();
    expect(usage).toMatchObject({ requests: 4, confidenceObservations: 2, lowConfidence: 1 });
  });

  it("never throws when the database rejects", async () => {
    query.mockRejectedValueOnce(new Error("postgres down"));
    expect(() => recordFunctionUsage("TEXT_EXTRACTION", { outcome: "success" })).not.toThrow();
    await settle();
  });

  it("getMetricsSummary rolls the durable rows up, surviving a process restart", async () => {
    recordFunctionUsage("RECEIPT_PARSING", { outcome: "success", tokensUsed: 100, lowConfidence: true });
    recordFunctionUsage("RECEIPT_PARSING", { outcome: "success", tokensUsed: 100, lowConfidence: false });
    recordFunctionUsage("RESUME_PARSING", { outcome: "error", tokensUsed: 20, fellBack: true });
    await settle();

    const summary = await getMetricsSummary();
    expect(summary).toMatchObject({
      totalRequests: 3,
      errorRequests: 1,
      totalTokens: 220,
      providerFallbacks: 1,
    });
    expect(summary.errorRate).toBeCloseTo(1 / 3);
    expect(summary.byFunction[0]).toMatchObject({
      function: "RECEIPT_PARSING",
      requests: 2,
      errors: 0,
      tokens: 200,
      lowConfidenceRatio: 0.5,
    });
    // A function nobody has scored reads as 0, never NaN from a 0/0 divide.
    expect(summary.byFunction[1]).toMatchObject({ function: "RESUME_PARSING", lowConfidenceRatio: 0 });
  });

  it("reports an empty summary rather than dividing by zero on a fresh install", async () => {
    await expect(getMetricsSummary()).resolves.toMatchObject({
      totalRequests: 0,
      errorRequests: 0,
      errorRate: 0,
      totalTokens: 0,
      providerFallbacks: 0,
      byFunction: [],
    });
  });
});
