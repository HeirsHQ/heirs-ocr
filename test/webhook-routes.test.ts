import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";

/**
 * The webhook routes as HTTP — the guard chain, not the handlers' internals.
 *
 * Everything else about webhooks is covered a layer down (webhooks.test.ts,
 * webhook-delivery.test.ts). What can only be seen from here is *wiring*: which
 * routes carry `requireTenantFeature`, whether the URL guard is consulted on update
 * as well as create, and the order the guards run in. Those are one-line mistakes
 * that no unit test of the pieces would notice — a missing gate on `rotate-secret`
 * leaves the whole capability reachable on a plan that does not include it.
 *
 * The real router is mounted on a real express app and driven over a loopback
 * socket, so the middleware chain runs exactly as it does in production. Only the
 * edges are doubled: Postgres (pg-mem), the session store, the billing lookup, the
 * audit sink, and the DNS-resolving destination guard.
 */
const { query, resetDb } = vi.hoisted(() => {
  const { newDb } = require("pg-mem") as typeof import("pg-mem");

  const DDL = `
    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL,
      url text NOT NULL,
      secret text NOT NULL,
      description text,
      events jsonb NOT NULL DEFAULT '[]',
      enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id uuid PRIMARY KEY,
      endpoint_id uuid NOT NULL,
      tenant_id text NOT NULL,
      event text NOT NULL,
      payload jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0,
      response_status integer,
      last_error text,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
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
  return { query, resetDb };
});

const { assertSafeWebhookUrl, session, tenantHasFeature } = vi.hoisted(() => ({
  /** Stubbed because the real one resolves DNS and is inert outside production. */
  assertSafeWebhookUrl: vi.fn(async (_url: string) => {}),
  /** The identity `tenantAuth` resolves the cookie to; swap per test. */
  session: {
    value: { userId: "u1", tenantId: "acme", role: "owner", label: "Ada Owner" } as
      | { userId: string; tenantId: string; role: string; label?: string }
      | undefined,
  },
  tenantHasFeature: vi.fn(async () => true),
}));

vi.mock("../src/db", () => ({
  query,
  ensureSchema: async () => {},
  whenDbReady: async () => {},
  closeDb: async () => {},
}));

vi.mock("../src/auth/tenant-session", () => ({
  SESSION_COOKIE: "tenant_session",
  resolveSession: async () => session.value,
  createSession: async () => ({ token: "t", ttlSeconds: 60 }),
  destroySession: async () => {},
  listSessions: async () => [],
  revokeOtherSessions: async () => 0,
}));

vi.mock("../src/billing/feature-access", () => ({ tenantHasFeature }));

/** The audit trail has its own table and its own tests; here it would only be noise. */
vi.mock("../src/observability/audit", () => ({ recordAuditEvent: vi.fn(async () => {}) }));

vi.mock("../src/webhooks/url-guard", async (importOriginal) => ({
  // The error class stays real — the route branches on `instanceof`, so a stand-in
  // would make the 400 path look right here while being dead code in production.
  ...(await importOriginal<typeof import("../src/webhooks/url-guard")>()),
  assertSafeWebhookUrl,
}));

import express from "express";

import { tenantApiRouter } from "../src/http/tenant/routes";
import { UnsafeWebhookUrlError } from "../src/webhooks/url-guard";
import { MAX_ENDPOINTS_PER_TENANT, createEndpoint, listEndpoints } from "../src/webhooks/store";

const app = express();
app.use(express.json());
app.use("/tenant", tenantApiRouter);

let server: ReturnType<typeof app.listen>;
let base = "";

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/tenant`;
        resolve();
      });
    }),
);

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(async () => {
  await resetDb();
  // `mockReset`, not `mockClear`: a `...Once` queued by a test that never consumed it
  // would otherwise fire in whichever test ran next, and the failure would land
  // somewhere unrelated to the cause.
  assertSafeWebhookUrl.mockReset();
  tenantHasFeature.mockReset();
  session.value = { userId: "u1", tenantId: "acme", role: "owner", label: "Ada Owner" };
});

type Body = { error?: { code: string; message: string }; items?: unknown[]; id?: string; url?: string };

const call = async (
  method: string,
  path: string,
  body?: unknown,
  opts: { cookie?: string } = {},
): Promise<{ status: number; body: Body }> => {
  const cookie = opts.cookie === undefined ? "tenant_session=token" : opts.cookie;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Body };
};

const seed = (over: { tenantId?: string; url?: string } = {}) =>
  createEndpoint({
    tenantId: over.tenantId ?? "acme",
    url: over.url ?? "https://receiver.test/hook",
    events: ["document.processed"],
  });

// ── The chain itself ──────────────────────────────────────────────────────────

describe("webhook route guards", () => {
  it("rejects an unauthenticated caller before any of it", async () => {
    const res = await call("GET", "/api/webhooks", undefined, { cookie: "" });
    expect(res.status).toBe(401);
    expect(tenantHasFeature).not.toHaveBeenCalled();
  });

  it("answers a member with FORBIDDEN, not NOT_ENTITLED", async () => {
    session.value = { userId: "u2", tenantId: "acme", role: "member" };
    tenantHasFeature.mockResolvedValue(false);

    const res = await call("POST", "/api/webhooks", { url: "https://a.test/h", events: ["document.processed"] });

    // Role is checked first, deliberately: telling a member to upgrade the org's plan
    // sends them to buy something that would not have let them do it either.
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("FORBIDDEN");
    expect(tenantHasFeature).not.toHaveBeenCalled();
  });
});

// ── Plan gate ─────────────────────────────────────────────────────────────────

describe("webhook plan gate", () => {
  /** Every route that creates or widens delivery. A gate missing from one is the bug. */
  const gated: [string, string, unknown?][] = [
    ["POST", "/api/webhooks", { url: "https://a.test/h", events: ["document.processed"] }],
    ["PATCH", "/api/webhooks/{id}", { enabled: false }],
    ["POST", "/api/webhooks/{id}/rotate-secret"],
    ["POST", "/api/webhooks/{id}/test"],
  ];

  it.each(gated)("gates %s %s on the plan", async (method, path, body) => {
    const endpoint = await seed();
    tenantHasFeature.mockResolvedValue(false);

    const res = await call(method, path.replace("{id}", endpoint.id), body);

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("NOT_ENTITLED");
    expect(tenantHasFeature).toHaveBeenCalledWith("acme", "webhooks");
  });

  /** The downgrade case: the rows outlive the entitlement, so they must stay reachable. */
  const open: [string, string][] = [
    ["GET", "/api/webhooks"],
    ["GET", "/api/webhooks/deliveries"],
    ["DELETE", "/api/webhooks/{id}"],
  ];

  it.each(open)("leaves %s %s open on a plan without webhooks", async (method, path) => {
    const endpoint = await seed();
    tenantHasFeature.mockResolvedValue(false);

    const res = await call(method, path.replace("{id}", endpoint.id));

    // Gating these would strand endpoints a tenant can neither see nor take down —
    // still receiving nothing, but with no way to clean them up short of support.
    expect(res.status).toBe(200);
  });

  it("still deletes the row when the plan no longer includes webhooks", async () => {
    const endpoint = await seed();
    tenantHasFeature.mockResolvedValue(false);

    expect((await call("DELETE", `/api/webhooks/${endpoint.id}`)).status).toBe(200);
    expect(await listEndpoints("acme")).toHaveLength(0);
  });

  it("does not create the endpoint it refused", async () => {
    tenantHasFeature.mockResolvedValue(false);

    await call("POST", "/api/webhooks", { url: "https://a.test/h", events: ["document.processed"] });

    expect(await listEndpoints("acme")).toHaveLength(0);
  });

  it("fails closed with 503 when the billing store cannot be read", async () => {
    tenantHasFeature.mockRejectedValue(new Error("billing store unavailable"));

    const res = await call("POST", "/api/webhooks", { url: "https://a.test/h", events: ["document.processed"] });

    // Not 500, and emphatically not "allow": serving through a billing outage would
    // ungate every tenant at once.
    expect(res.status).toBe(503);
    expect(res.body.error?.code).toBe("PROVIDER_UNAVAILABLE");
    expect(await listEndpoints("acme")).toHaveLength(0);
  });

  it("admits an entitled owner", async () => {
    const res = await call("POST", "/api/webhooks", {
      url: "https://a.test/h",
      events: ["document.processed"],
    });

    expect(res.status).toBe(201);
    expect(tenantHasFeature).toHaveBeenCalledWith("acme", "webhooks");
  });
});

// ── Endpoint cap ──────────────────────────────────────────────────────────────

describe("webhook endpoint cap", () => {
  const fill = async (n: number) => {
    for (let i = 0; i < n; i += 1) await seed({ url: `https://r${i}.test/hook` });
  };

  it("admits the one that reaches the limit", async () => {
    await fill(MAX_ENDPOINTS_PER_TENANT - 1);

    const res = await call("POST", "/api/webhooks", { url: "https://last.test/h", events: ["document.processed"] });

    expect(res.status).toBe(201);
    expect(await listEndpoints("acme")).toHaveLength(MAX_ENDPOINTS_PER_TENANT);
  });

  it("refuses the one past it with LIMIT_REACHED", async () => {
    await fill(MAX_ENDPOINTS_PER_TENANT);

    const res = await call("POST", "/api/webhooks", { url: "https://over.test/h", events: ["document.processed"] });

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("LIMIT_REACHED");
    // The message names both numbers: a bare "limit reached" leaves the tenant
    // guessing how many they have and how many they are allowed.
    expect(res.body.error?.message).toContain(String(MAX_ENDPOINTS_PER_TENANT));
    expect(await listEndpoints("acme")).toHaveLength(MAX_ENDPOINTS_PER_TENANT);
  });

  it("counts per org, so a full neighbour does not block anyone", async () => {
    for (let i = 0; i < MAX_ENDPOINTS_PER_TENANT; i += 1) {
      await seed({ tenantId: "globex", url: `https://g${i}.test/hook` });
    }

    expect(
      (await call("POST", "/api/webhooks", { url: "https://a.test/h", events: ["document.processed"] })).status,
    ).toBe(201);
  });
});

// ── Destination guard ─────────────────────────────────────────────────────────

describe("webhook destination guard wiring", () => {
  const unsafe = () =>
    new UnsafeWebhookUrlError("evil.test resolves to 169.254.169.254, which is not a public address");

  it("checks the URL a create submits", async () => {
    await call("POST", "/api/webhooks", { url: "https://a.test/h", events: ["document.processed"] });
    expect(assertSafeWebhookUrl).toHaveBeenCalledWith("https://a.test/h");
  });

  it("refuses a create pointed somewhere internal", async () => {
    assertSafeWebhookUrl.mockRejectedValueOnce(unsafe());

    const res = await call("POST", "/api/webhooks", { url: "https://evil.test/h", events: ["document.processed"] });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("INVALID_ARGS");
    // The reason reaches the tenant: "invalid URL" on a URL that looks fine is a
    // support ticket.
    expect(res.body.error?.message).toContain("169.254.169.254");
    expect(await listEndpoints("acme")).toHaveLength(0);
  });

  it("checks the URL an update submits, too", async () => {
    const endpoint = await seed();
    assertSafeWebhookUrl.mockRejectedValueOnce(unsafe());

    const res = await call("PATCH", `/api/webhooks/${endpoint.id}`, { url: "https://evil.test/h" });

    // Guarding only create would leave the whole thing open: register a public URL,
    // then edit it to an internal one.
    expect(res.status).toBe(400);
    expect((await listEndpoints("acme"))[0]!.url).toBe("https://receiver.test/hook");
  });

  it("skips the check on an update that does not touch the URL", async () => {
    const endpoint = await seed();

    const res = await call("PATCH", `/api/webhooks/${endpoint.id}`, { enabled: false });

    expect(res.status).toBe(200);
    // No URL, nothing to resolve — a DNS lookup here would be latency for nothing.
    expect(assertSafeWebhookUrl).not.toHaveBeenCalled();
  });

  it("does not turn a resolver fault into a 400", async () => {
    assertSafeWebhookUrl.mockRejectedValueOnce(new Error("EMFILE: too many open files"));

    const res = await call("POST", "/api/webhooks", { url: "https://a.test/h", events: ["document.processed"] });

    // Only an UnsafeWebhookUrlError means "this URL is bad". Anything else is our
    // problem, and telling the tenant their URL is invalid would send them chasing it.
    expect(res.status).toBe(500);
    expect(res.body.error?.code).toBe("INTERNAL");
  });

  it("rejects a non-https URL before it ever reaches the guard", async () => {
    const res = await call("POST", "/api/webhooks", { url: "ftp://a.test/h", events: ["document.processed"] });

    expect(res.status).toBe(400);
    expect(assertSafeWebhookUrl).not.toHaveBeenCalled();
  });
});
