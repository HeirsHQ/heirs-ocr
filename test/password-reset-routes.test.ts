import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";

/**
 * The tenant forgot/reset-password routes as HTTP.
 *
 * What matters here is what a caller can observe: that `/api/password/forgot` never
 * reveals whether an address has an account, that the link is single-use and
 * short-lived and never held in the clear, that a failed policy check doesn't burn
 * it, and that a completed reset revokes every session without minting a new one
 * (which would let an MFA account skip its second factor).
 *
 * Same harness as test/signup-routes.test.ts: the real router over a loopback
 * socket, with Postgres (pg-mem), Redis, the mailer and the audit sink doubled.
 */
const { query, resetDb, redisStore, redisSets, fakeRedis, resetMail, changedMail } = vi.hoisted(() => {
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
      created_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tenant_users (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL,
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      role text NOT NULL,
      password_hash text NOT NULL,
      disabled boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    );
  `;

  let mem = newDb();
  let pool = new (mem.adapters.createPg().Pool)();

  const query = vi.fn((text: string, params?: unknown[]) => pool.query(text, params));
  const resetDb = async () => {
    mem = newDb();
    pool = new (mem.adapters.createPg().Pool)();
    mem.public.none(DDL);
    query.mockReset();
    query.mockImplementation((text: string, params?: unknown[]) => pool.query(text, params));
  };

  const redisStore = new Map<string, string>();
  const redisSets = new Map<string, Set<string>>();
  const fakeRedis = {
    get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      redisStore.set(key, value);
      return "OK";
    }),
    getdel: vi.fn(async (key: string) => {
      const value = redisStore.get(key) ?? null;
      redisStore.delete(key);
      return value;
    }),
    del: vi.fn(async (...keys: string[]) => keys.filter((k) => redisStore.delete(k) || redisSets.delete(k)).length),
    ttl: vi.fn(async (key: string) => (redisStore.has(key) ? 900 : -2)),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    sadd: vi.fn(async (key: string, ...members: string[]) => {
      const set = redisSets.get(key) ?? new Set<string>();
      members.forEach((m) => set.add(m));
      redisSets.set(key, set);
      return members.length;
    }),
    srem: vi.fn(
      async (key: string, ...members: string[]) => members.filter((m) => redisSets.get(key)?.delete(m)).length,
    ),
    smembers: vi.fn(async (key: string) => [...(redisSets.get(key) ?? [])]),
    ping: vi.fn(async () => "PONG"),
  };

  /** Every reset email sent, so a test can pull the link back out. */
  const resetMail: { to: string; ResetUrl: string; tenantName: string }[] = [];
  const changedMail: { to: string }[] = [];

  return { query, resetDb, redisStore, redisSets, fakeRedis, resetMail, changedMail };
});

vi.mock("../src/db", () => ({
  query,
  ensureSchema: async () => {},
  whenDbReady: async () => {},
  closeDb: async () => {},
}));
vi.mock("../src/redis", () => ({ getRedis: () => fakeRedis, whenRedisReady: async () => {} }));
vi.mock("../src/observability/audit", () => ({ recordAuditEvent: vi.fn(async () => {}) }));

const mailResult = { value: { delivered: true } as { delivered: boolean; error?: string; skipped?: string } };
vi.mock("../src/notification/mail", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sendPasswordResetEmail: vi.fn(async (r: { to: string; tenantName: string }, a: { ResetUrl: string }) => {
      resetMail.push({ to: r.to, ResetUrl: a.ResetUrl, tenantName: r.tenantName });
      return mailResult.value;
    }),
    sendPasswordChangedEmail: vi.fn(async (r: { to: string }) => {
      changedMail.push({ to: r.to });
      return { delivered: true };
    }),
  };
});

import express from "express";

import { openApiRouter } from "../src/http/tenant/routes";
import { createTenantUser, getTenantUserByEmail, updateTenantUser, verifyPassword } from "../src/auth/tenant-users";
import { createSession, resolveSession } from "../src/auth/tenant-session";
import { generateApiKey, putTenant } from "../src/auth/tenants";

const app = express();
app.use(express.json());
app.use("/api", openApiRouter);

let server: ReturnType<typeof app.listen>;
let base = "";

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    }),
);

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

type Body = {
  error?: { code: string; message: string };
  pending?: boolean;
  email?: string;
  expiresInMinutes?: number;
  ok?: boolean;
};

const call = async (path: string, body: unknown): Promise<{ status: number; body: Body; setCookie: string[] }> => {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Body,
    setCookie: res.headers.getSetCookie(),
  };
};

const EMAIL = "ada@example.test";
const OLD_PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a brand new passphrase";

const seedUser = async () => {
  await putTenant(generateApiKey(), { tenantId: "acme", name: "Acme Documents", createdAt: new Date().toISOString() });
  return createTenantUser({
    tenantId: "acme",
    email: EMAIL,
    name: "Ada Okafor",
    role: "owner",
    password: OLD_PASSWORD,
  });
};

/** Requests a link and returns the token from the email the route sent. */
const requestLink = async (email = EMAIL) => {
  const res = await call("/api/password/forgot", { email });
  const url = resetMail.at(-1)?.ResetUrl;
  const token = url ? (new URL(url).searchParams.get("token") ?? undefined) : undefined;
  return { res, token };
};

beforeEach(async () => {
  await resetDb();
  redisStore.clear();
  redisSets.clear();
  resetMail.length = 0;
  changedMail.length = 0;
  mailResult.value = { delivered: true };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/password/forgot", () => {
  it("mails a reset link for a real account, addressed with the org name", async () => {
    await seedUser();
    const { res, token } = await requestLink();

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ pending: true, email: EMAIL, expiresInMinutes: 30 });
    expect(resetMail).toHaveLength(1);
    expect(resetMail[0]!.ResetUrl).toContain("/reset-password?token=");
    expect(resetMail[0]!.tenantName).toBe("Acme Documents");
    expect(token).toBeTruthy();
  });

  it("answers an unknown address exactly as a real one, and sends nothing", async () => {
    await seedUser();
    const real = await call("/api/password/forgot", { email: EMAIL });
    const unknown = await call("/api/password/forgot", { email: "nobody@example.test" });

    expect(unknown.status).toBe(real.status);
    expect(unknown.body).toEqual({ ...real.body, email: "nobody@example.test" });
    expect(resetMail.map((m) => m.to)).toEqual([EMAIL]);
  });

  it("sends nothing for a disabled account", async () => {
    const user = await seedUser();
    await updateTenantUser(user.tenantId, user.id, { disabled: true });

    const { res } = await requestLink();
    expect(res.status).toBe(202);
    expect(resetMail).toEqual([]);
  });

  it("never returns the token over the wire or stores it in the clear", async () => {
    await seedUser();
    const { res, token } = await requestLink();

    expect(JSON.stringify(res.body)).not.toContain(token!);
    const stored = [...redisStore.entries()].flat().join("\n");
    expect(stored).not.toContain(token!);
  });

  it("sends at most one email per cooldown, answering the same either way", async () => {
    await seedUser();
    await requestLink();
    const { res } = await requestLink();

    expect(res.status).toBe(202);
    expect(resetMail).toHaveLength(1);
  });

  it("a newer link revokes the older one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await seedUser();
    const first = await requestLink();
    vi.setSystemTime(Date.now() + 61_000);
    const second = await requestLink();

    expect(second.token).not.toBe(first.token);
    expect((await call("/api/password/reset", { token: first.token, password: NEW_PASSWORD })).status).toBe(401);
    expect((await call("/api/password/reset", { token: second.token, password: NEW_PASSWORD })).status).toBe(200);
  });

  it("does not reveal a mail failure, and revokes the undelivered link", async () => {
    await seedUser();
    mailResult.value = { delivered: false, error: "smtp refused" };
    const { res, token } = await requestLink();

    expect(res.status).toBe(202);
    expect((await call("/api/password/reset", { token, password: NEW_PASSWORD })).status).toBe(401);
  });

  it("rejects a malformed address", async () => {
    const { status, body } = await call("/api/password/forgot", { email: "not-an-email" });
    expect(status).toBe(400);
    expect(body.error?.code).toBe("INVALID_ARGS");
  });
});

describe("POST /api/password/reset", () => {
  it("replaces the password, revokes every session, and mails a confirmation", async () => {
    const user = await seedUser();
    const session = await createSession(user.id, user.tenantId, user.role);
    const { token } = await requestLink();

    const { status, body, setCookie } = await call("/api/password/reset", { token, password: NEW_PASSWORD });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });

    const stored = (await getTenantUserByEmail(EMAIL))!;
    expect(await verifyPassword(stored, NEW_PASSWORD)).toBe(true);
    expect(await verifyPassword(stored, OLD_PASSWORD)).toBe(false);

    expect(await resolveSession(session.token)).toBeUndefined();
    // No session minted: that would skip the second factor on an MFA account.
    expect(setCookie.join(";")).not.toContain("tenant_session=");
    expect(changedMail.map((m) => m.to)).toEqual([EMAIL]);
  });

  it("will not redeem the same link twice", async () => {
    await seedUser();
    const { token } = await requestLink();

    expect((await call("/api/password/reset", { token, password: NEW_PASSWORD })).status).toBe(200);
    const again = await call("/api/password/reset", { token, password: "yet another passphrase" });
    expect(again.status).toBe(401);
    expect(again.body.error?.message).toMatch(/invalid or has expired/);
  });

  it("enforces the password policy without burning the link", async () => {
    await seedUser();
    const { token } = await requestLink();

    const weak = await call("/api/password/reset", { token, password: "short" });
    expect(weak.status).toBe(400);
    expect(weak.body.error?.code).toBe("INVALID_ARGS");

    expect((await call("/api/password/reset", { token, password: NEW_PASSWORD })).status).toBe(200);
  });

  it("rejects a token that was never issued", async () => {
    await seedUser();
    const { status, body } = await call("/api/password/reset", { token: "made-up", password: NEW_PASSWORD });
    expect(status).toBe(401);
    expect(body.error?.code).toBe("UNAUTHORIZED");
  });

  it("refuses a link whose account was disabled after it was sent", async () => {
    const user = await seedUser();
    const { token } = await requestLink();
    await updateTenantUser(user.tenantId, user.id, { disabled: true });

    expect((await call("/api/password/reset", { token, password: NEW_PASSWORD })).status).toBe(401);
    expect(await verifyPassword({ ...(await getTenantUserByEmail(EMAIL))!, disabled: false }, OLD_PASSWORD)).toBe(true);
  });

  it("requires a token", async () => {
    const { status } = await call("/api/password/reset", { password: NEW_PASSWORD });
    expect(status).toBe(400);
  });
});
