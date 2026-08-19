import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Webhook signing, dispatch, and delivery.
 *
 * Two of the store's statements — `claimDueDeliveries` (a CTE with `FOR UPDATE ...
 * SKIP LOCKED`, which is what makes multiple workers safe) and
 * `reapOrphanedDeliveries` (a correlated subquery inside an UPDATE) — are not
 * supported by pg-mem. They are deliberately *not* rewritten to suit the double:
 * losing SKIP LOCKED would mean every replica sending every delivery. The delivery
 * loop's decision-making is covered instead by stubbing the store, so what goes
 * untested here is the SQL those two run, not the behaviour around it.
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

vi.mock("../src/db", () => ({
  query,
  ensureSchema: async () => {},
  whenDbReady: async () => {},
  closeDb: async () => {},
}));

import { signPayload, verifySignature, SIGNATURE_HEADER } from "../src/webhooks/signing";
import {
  createEndpoint,
  deleteEndpoint,
  endpointsForEvent,
  enqueueDelivery,
  generateSecret,
  listDeliveriesPage,
  listEndpoints,
  markDelivered,
  markFailed,
  purgeDeliveriesOlderThan,
  rotateSecret,
  updateEndpoint,
} from "../src/webhooks/store";
import { dispatchDocumentEvent } from "../src/webhooks/dispatch";
import { backoffMs, MAX_ATTEMPTS } from "../src/webhooks/deliver";

beforeEach(resetDb);

// ── Signing ───────────────────────────────────────────────────────────────────

describe("webhook signing", () => {
  const body = JSON.stringify({ event: "document.processed" });
  const secret = "whsec_test";

  it("produces a t=…,v1=… header that verifies", () => {
    const now = 1_700_000_000;
    const header = signPayload(body, secret, now);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifySignature(body, header, secret, { now })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const now = 1_700_000_000;
    const header = signPayload(body, secret, now);
    expect(verifySignature(body + " ", header, secret, { now })).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const now = 1_700_000_000;
    expect(verifySignature(body, signPayload(body, secret, now), "whsec_other", { now })).toBe(false);
  });

  it("rejects a replay outside the tolerance window", () => {
    const signedAt = 1_700_000_000;
    const header = signPayload(body, secret, signedAt);

    // The timestamp is inside the signed material, so an attacker cannot move it
    // forward — an old capture stays old, and the receiver refuses it.
    expect(verifySignature(body, header, secret, { now: signedAt + 60 })).toBe(true);
    expect(verifySignature(body, header, secret, { now: signedAt + 3600 })).toBe(false);
  });

  it("rejects a malformed header rather than throwing", () => {
    for (const bad of ["", "garbage", "t=abc,v1=xyz", "v1=deadbeef", "t=1700000000"]) {
      expect(verifySignature(body, bad, secret, { now: 1_700_000_000 })).toBe(false);
    }
  });

  it("names the header the receiver should read", () => {
    expect(SIGNATURE_HEADER).toBe("X-Heirs-Signature");
  });
});

// ── Endpoints ─────────────────────────────────────────────────────────────────

describe("webhook endpoints", () => {
  const create = (over: Partial<Parameters<typeof createEndpoint>[0]> = {}) =>
    createEndpoint({
      tenantId: "acme",
      url: "https://example.test/hook",
      events: ["document.processed"],
      ...over,
    });

  it("mints a distinct secret per endpoint and returns it once", async () => {
    const a = await create();
    const b = await create();
    expect(a.secret).toMatch(/^whsec_/);
    expect(a.secret).not.toBe(b.secret);

    // The listing never carries it — it is returned at creation and on rotation only.
    const listed = await listEndpoints("acme");
    expect(listed).toHaveLength(2);
    expect(JSON.stringify(listed)).not.toContain(a.secret);
  });

  it("scopes every read to one org", async () => {
    await create();
    await create({ tenantId: "other" });
    expect(await listEndpoints("acme")).toHaveLength(1);
    expect(await listEndpoints("other")).toHaveLength(1);
  });

  it("rotating replaces the secret", async () => {
    const created = await create();
    const rotated = await rotateSecret("acme", created.id);
    expect(rotated!.secret).not.toBe(created.secret);
  });

  it("refuses to touch another org's endpoint", async () => {
    const created = await create();
    expect(await rotateSecret("other", created.id)).toBeUndefined();
    expect(await updateEndpoint("other", created.id, { enabled: false })).toBeUndefined();
    expect(await deleteEndpoint("other", created.id)).toBe(false);
    // ...and it is still there for its real owner.
    expect(await listEndpoints("acme")).toHaveLength(1);
  });

  it("selects only enabled endpoints subscribed to the event", async () => {
    await create({ events: ["document.processed"] });
    await create({ events: ["document.failed"] });
    const disabled = await create({ events: ["document.processed"] });
    await updateEndpoint("acme", disabled.id, { enabled: false });

    const matched = await endpointsForEvent("acme", "document.processed");
    expect(matched).toHaveLength(1);
    expect(matched[0]!.enabled).toBe(true);
  });

  it("generates secrets with real entropy", () => {
    const secrets = new Set(Array.from({ length: 50 }, generateSecret));
    expect(secrets.size).toBe(50);
  });
});

// ── Dispatch ──────────────────────────────────────────────────────────────────

describe("webhook dispatch", () => {
  const seedEndpoint = (events: ("document.processed" | "document.failed")[]) =>
    createEndpoint({ tenantId: "acme", url: "https://example.test/hook", events });

  const dispatch = (over: Partial<Parameters<typeof dispatchDocumentEvent>[0]> = {}) =>
    dispatchDocumentEvent({
      tenantId: "acme",
      functionKey: "TEXT_EXTRACTION",
      sensitivity: "standard",
      outcome: "success",
      pageCount: 3,
      fileName: "invoice.pdf",
      ...over,
    });

  const deliveries = async () => (await listDeliveriesPage({ tenantId: "acme", page: 1, pageSize: 25 })).items;
  const payloadOf = async (id: string) => {
    const { rows } = await query(`SELECT payload FROM webhook_deliveries WHERE id = $1`, [id]);
    return (rows[0] as { payload: Record<string, unknown> }).payload;
  };

  it("queues one delivery per subscribed endpoint", async () => {
    await seedEndpoint(["document.processed"]);
    await seedEndpoint(["document.processed"]);
    await seedEndpoint(["document.failed"]);

    await dispatch();
    expect(await deliveries()).toHaveLength(2);
  });

  it("routes a failure to document.failed subscribers", async () => {
    await seedEndpoint(["document.failed"]);
    await dispatch({ outcome: "error" });

    const [delivery] = await deliveries();
    expect(delivery!.event).toBe("document.failed");
  });

  it("queues nothing when no endpoint subscribes", async () => {
    await dispatch();
    expect(await deliveries()).toHaveLength(0);
  });

  it("withholds the filename for a pii function but still fires the event", async () => {
    await seedEndpoint(["document.processed"]);
    await dispatch({ sensitivity: "pii", functionKey: "ID_VERIFICATION", fileName: "jane-passport.pdf" });

    const [delivery] = await deliveries();
    const payload = await payloadOf(delivery!.id);
    // The tenant is told a document was processed — not what it was called. A
    // filename is identifying, and this leaves for a third-party URL.
    expect(payload.fileName).toBeUndefined();
    expect(payload.functionKey).toBe("ID_VERIFICATION");
    expect(JSON.stringify(payload)).not.toContain("jane-passport");
  });

  it("includes the filename for a standard function", async () => {
    await seedEndpoint(["document.processed"]);
    await dispatch();

    const payload = await payloadOf((await deliveries())[0]!.id);
    expect(payload.fileName).toBe("invoice.pdf");
  });

  it("carries a delivery id matching the row, so receivers can dedupe retries", async () => {
    await seedEndpoint(["document.processed"]);
    await dispatch();

    const [delivery] = await deliveries();
    expect((await payloadOf(delivery!.id)).deliveryId).toBe(delivery!.id);
  });

  it("swallows a store failure rather than failing the OCR request behind it", async () => {
    query.mockImplementationOnce(() => Promise.reject(new Error("db down")));
    await expect(dispatch()).resolves.toBeUndefined();
  });
});

// ── Delivery outcome bookkeeping ──────────────────────────────────────────────

describe("delivery outcomes", () => {
  const seed = async () => {
    const endpoint = await createEndpoint({
      tenantId: "acme",
      url: "https://example.test/hook",
      events: ["document.processed"],
    });
    const id = "33333333-3333-3333-3333-333333333333";
    await enqueueDelivery({ id, endpointId: endpoint.id, tenantId: "acme", event: "document.processed", payload: {} });
    return id;
  };

  const read = async (id: string) =>
    (await listDeliveriesPage({ tenantId: "acme", page: 1, pageSize: 25 })).items.find((d) => d.id === id)!;

  it("marks a delivered webhook succeeded and clears the last error", async () => {
    const id = await seed();
    await markFailed({ id, error: "boom", retryAt: new Date() });
    await markDelivered(id, 200);

    const delivery = await read(id);
    expect(delivery.status).toBe("succeeded");
    expect(delivery.responseStatus).toBe(200);
    expect(delivery.lastError).toBeNull();
  });

  it("keeps a retryable failure pending with a future next attempt", async () => {
    const id = await seed();
    const retryAt = new Date(Date.now() + 60_000);
    await markFailed({ id, responseStatus: 500, error: "Receiver responded 500", retryAt });

    const delivery = await read(id);
    expect(delivery.status).toBe("pending");
    expect(delivery.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("marks a delivery dead when no retry is scheduled", async () => {
    const id = await seed();
    await markFailed({ id, error: "gave up" });
    expect((await read(id)).status).toBe("dead");
  });

  it("truncates a hostile error message rather than storing it whole", async () => {
    const id = await seed();
    await markFailed({ id, error: "x".repeat(5_000) });
    expect((await read(id)).lastError!.length).toBeLessThanOrEqual(500);
  });
});

// ── Backoff ───────────────────────────────────────────────────────────────────

describe("retry backoff", () => {
  it("doubles each attempt", () => {
    expect(backoffMs(1)).toBe(10_000);
    expect(backoffMs(2)).toBe(20_000);
    expect(backoffMs(3)).toBe(40_000);
  });

  it("gives up after a bounded number of attempts", () => {
    // An unbounded retry queue against a host that is never coming back is how a
    // webhook system becomes an outage of its own.
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});

// ── Retention ─────────────────────────────────────────────────────────────────

describe("delivery log retention", () => {
  it("purges only deliveries past the window", async () => {
    const endpoint = await createEndpoint({
      tenantId: "acme",
      url: "https://example.test/hook",
      events: ["document.processed"],
    });
    for (const id of ["44444444-4444-4444-4444-444444444444", "55555555-5555-5555-5555-555555555555"]) {
      await enqueueDelivery({
        id,
        endpointId: endpoint.id,
        tenantId: "acme",
        event: "document.processed",
        payload: {},
      });
    }
    await query(`UPDATE webhook_deliveries SET created_at = $1 WHERE id = $2`, [
      new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
      "44444444-4444-4444-4444-444444444444",
    ]);

    expect(await purgeDeliveriesOlderThan(90)).toBe(1);
    expect((await listDeliveriesPage({ tenantId: "acme", page: 1, pageSize: 25 })).total).toBe(1);
  });
});
