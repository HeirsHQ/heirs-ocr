import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Backing stores for the admin-console features (audit trail, logs, platform
 * settings, configuration backups). `query` runs real SQL against pg-mem so the
 * stores exercise their actual statements; `fakeRedis` implements the list
 * semantics the log ring buffer relies on (multi/lpush/ltrim/lrange).
 */
const { query, resetDb, fakeRedis, lists } = vi.hoisted(() => {
  const { newDb } = require("pg-mem") as typeof import("pg-mem");

  const DDL = `
    CREATE TABLE IF NOT EXISTS platform_settings (
      namespace text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tenant_settings (
      tenant_id text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id uuid PRIMARY KEY,
      action text NOT NULL,
      actor text NOT NULL,
      actor_label text,
      target text,
      target_label text,
      metadata jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS plans (
      id text PRIMARY KEY, tier text NOT NULL, hidden boolean NOT NULL DEFAULT false,
      data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      tenant_id text PRIMARY KEY, plan_id text NOT NULL, status text NOT NULL,
      data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS backups (
      id uuid PRIMARY KEY, created_by text NOT NULL, note text,
      counts jsonb NOT NULL DEFAULT '{}', size_bytes integer NOT NULL DEFAULT 0,
      data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
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

  // Minimal Redis list semantics (newest-first via lpush) for the log buffer.
  const lists = new Map<string, string[]>();
  const makeMulti = () => {
    const ops: (() => void)[] = [];
    const chain: any = {
      lpush: (key: string, value: string) => {
        ops.push(() => {
          const arr = lists.get(key) ?? [];
          arr.unshift(value);
          lists.set(key, arr);
        });
        return chain;
      },
      ltrim: (key: string, start: number, stop: number) => {
        ops.push(() => {
          const arr = lists.get(key) ?? [];
          lists.set(key, arr.slice(start, stop + 1));
        });
        return chain;
      },
      exec: async () => {
        ops.forEach((op) => op());
        return [];
      },
    };
    return chain;
  };
  const fakeRedis = {
    multi: makeMulti,
    lrange: async (key: string, start: number, stop: number) => (lists.get(key) ?? []).slice(start, stop + 1),
    ping: async () => "PONG",
  };

  return { query, resetDb, fakeRedis, lists };
});

vi.mock("../src/db", () => ({
  query,
  ensureSchema: async () => {},
  whenDbReady: async () => {},
  closeDb: async () => {},
}));
vi.mock("../src/redis", () => ({
  getRedis: () => fakeRedis,
  peekRedis: () => fakeRedis,
  whenRedisReady: async () => {},
}));

import { getSettings, putSettings } from "../src/config/settings-store";
import { getTenantSettings, putTenantSettings } from "../src/config/tenant-settings";
import { listAuditEvents, listAuditEventsPage, recordAuditEvent } from "../src/observability/audit";
import { captureLog, recentLogs } from "../src/observability/log-buffer";
import { createBackup, getBackup, listBackups, restoreBackup } from "../src/ops/backups";
import {
  createSubscriptionFromPlan,
  getSubscriptionSummary,
  putSubscription,
  toEffectiveSubscription,
} from "../src/billing/subscriptions";
import { getPlan } from "../src/billing/plans";

const reset = async () => {
  await resetDb();
  lists.clear();
};

describe("platform settings store", () => {
  beforeEach(reset);

  it("returns schema defaults for a namespace with no stored row", async () => {
    const s = await getSettings("notifications");
    expect(s.channels).toEqual([]);
    expect(s.events.jobFailed).toBe(true);
  });

  it("validates and round-trips a write", async () => {
    const saved = await putSettings("api_integrations", {
      integrations: [{ id: "i1", name: "Slack", kind: "slack", url: "https://hooks", createdAt: "2026-08-12" }],
    });
    expect(saved.integrations[0]!.enabled).toBe(true); // default filled
    const read = await getSettings("api_integrations");
    expect(read.integrations).toHaveLength(1);
    expect(read.integrations[0]!.name).toBe("Slack");
  });

  it("rejects an invalid payload", async () => {
    await expect(putSettings("security", { passwordMinLength: 2 })).rejects.toThrow();
  });
});

describe("audit trail", () => {
  beforeEach(reset);

  it("records events and lists them most-recent-first", async () => {
    await recordAuditEvent({ action: "tenant.created", actor: "admin1", target: "t1" });
    await recordAuditEvent({ action: "admin.created", actor: "admin1", target: "a2" });
    const events = await listAuditEvents();
    expect(events).toHaveLength(2);
    expect(events[0]!.action).toBe("admin.created"); // newest first
  });

  it("filters by action prefix and actor", async () => {
    await recordAuditEvent({ action: "tenant.created", actor: "admin1" });
    await recordAuditEvent({ action: "tenant.revoked", actor: "admin2" });
    await recordAuditEvent({ action: "backup.created", actor: "admin1" });
    expect(await listAuditEvents({ action: "tenant." })).toHaveLength(2);
    expect(await listAuditEvents({ actor: "admin1" })).toHaveLength(2);
  });

  it("never throws into the caller on a store failure", async () => {
    query.mockImplementationOnce(() => Promise.reject(new Error("db down")));
    await expect(recordAuditEvent({ action: "x", actor: "y" })).resolves.toBeUndefined();
  });

  // Paged in SQL rather than by slicing a full read — audit_events is the one admin
  // table that grows without bound, so these pin the LIMIT/OFFSET and its COUNT.
  it("pages in SQL, reporting the full total alongside the window", async () => {
    for (let i = 0; i < 5; i++) {
      await recordAuditEvent({ action: `tenant.step${i}`, actor: "admin1" });
    }

    const first = await listAuditEventsPage({ page: 1, pageSize: 2 });
    expect(first.total).toBe(5);
    expect(first.items).toHaveLength(2);

    const last = await listAuditEventsPage({ page: 3, pageSize: 2 });
    expect(last.total).toBe(5);
    expect(last.items).toHaveLength(1);

    // No row appears on two pages, and none is skipped between them. All five are
    // written in the same millisecond here, which is exactly the case an unstable
    // sort gets wrong — hence the `id` tiebreaker in the ORDER BY.
    const second = await listAuditEventsPage({ page: 2, pageSize: 2 });
    const ids = [...first.items, ...second.items, ...last.items].map((e) => e.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("counts against the same filter it pages, so total can't disagree with items", async () => {
    await recordAuditEvent({ action: "tenant.created", actor: "admin1" });
    await recordAuditEvent({ action: "tenant.revoked", actor: "admin2" });
    await recordAuditEvent({ action: "backup.created", actor: "admin1" });

    const page = await listAuditEventsPage({ action: "tenant.", page: 1, pageSize: 10 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);

    const byActor = await listAuditEventsPage({ actor: "admin1", page: 1, pageSize: 1 });
    expect(byActor.total).toBe(2);
    expect(byActor.items).toHaveLength(1);
  });

  it("returns an empty page past the end rather than throwing", async () => {
    await recordAuditEvent({ action: "tenant.created", actor: "admin1" });
    await expect(listAuditEventsPage({ page: 9, pageSize: 10 })).resolves.toMatchObject({ items: [], total: 1 });
  });
});

describe("log ring buffer", () => {
  beforeEach(reset);

  it("captures entries and returns them newest-first", async () => {
    captureLog("info", "first", { a: 1 });
    captureLog("warn", "second", {});
    await new Promise((r) => setTimeout(r, 0)); // let the multi().exec() microtask settle
    const entries = await recentLogs();
    expect(entries[0]!.msg).toBe("second");
    expect(entries).toHaveLength(2);
  });

  it("filters to a minimum level", async () => {
    captureLog("debug", "d", {});
    captureLog("error", "e", {});
    await new Promise((r) => setTimeout(r, 0));
    const errs = await recentLogs({ level: "warn" });
    expect(errs).toHaveLength(1);
    expect(errs[0]!.level).toBe("error");
  });
});

describe("configuration backup & restore", () => {
  beforeEach(reset);

  const seedPlan = () =>
    query(`INSERT INTO plans (id, tier, hidden, data) VALUES ($1,$2,$3,$4)`, [
      "starter",
      "starter",
      false,
      JSON.stringify({ id: "starter", tier: "starter" }),
    ]);

  it("captures a snapshot with per-table counts and lists it", async () => {
    await seedPlan();
    await putSettings("platform", { maintenanceMode: true });
    const manifest = await createBackup({ actor: "admin1", note: "nightly" });
    expect(manifest.counts.plans).toBe(1);
    expect(manifest.counts.platform_settings).toBe(1);
    expect(manifest.sizeBytes).toBeGreaterThan(0);
    const all = await listBackups();
    expect(all).toHaveLength(1);
    expect(all[0]!.note).toBe("nightly");
  });

  it("restores captured rows idempotently", async () => {
    await seedPlan();
    const manifest = await createBackup({ actor: "admin1" });
    // Mutate after the backup, then restore to prove the snapshot is re-applied.
    await query(`DELETE FROM plans WHERE id = 'starter'`);
    expect((await getBackup(manifest.id))!.data.plans).toHaveLength(1);
    const applied = await restoreBackup(manifest.id);
    expect(applied!.plans).toBe(1);
    const { rows } = await query(`SELECT id FROM plans WHERE id = 'starter'`);
    expect(rows).toHaveLength(1);
  });

  it("returns undefined restoring an unknown backup", async () => {
    expect(await restoreBackup("00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });
});

describe("subscription summary — the console's stat tiles", () => {
  beforeEach(reset);

  /** Enrols a tenant on a catalog plan, then forces a status/accrual for the test. */
  const enrol = async (
    tenantId: string,
    planId: string,
    over: { status?: string; amountAccruedMinor?: number } = {},
  ) => {
    const sub = createSubscriptionFromPlan(tenantId, getPlan(planId)!);
    await putSubscription({
      ...sub,
      status: (over.status ?? sub.status) as typeof sub.status,
      usage: { ...sub.usage, amountAccruedMinor: over.amountAccruedMinor ?? 0 },
    });
  };

  it("counts the whole estate, not one page of it", async () => {
    await enrol("a", "starter", { status: "active" });
    await enrol("b", "starter", { status: "trialing" });
    await enrol("c", "starter", { status: "past_due" });
    await enrol("d", "starter", { status: "canceled" });

    const summary = await getSubscriptionSummary();
    expect(summary.total).toBe(4);
    // "Serving" and "needs attention" are the two buckets the tiles show; the full
    // per-status split rides along for anything that wants finer detail.
    expect(summary.serving).toBe(2);
    expect(summary.attention).toBe(1);
    expect(summary.byStatus).toMatchObject({ active: 1, trialing: 1, past_due: 1, canceled: 1 });
  });

  it("groups accrued amounts by currency rather than summing across them", async () => {
    await enrol("a", "starter", { amountAccruedMinor: 5_000 });
    await enrol("b", "starter", { amountAccruedMinor: 1_500 });

    const summary = await getSubscriptionSummary();
    // Adding different currencies together would produce a number that means nothing,
    // so the shape is a list even when there is only one entry in it.
    expect(summary.accruedByCurrency).toHaveLength(1);
    expect(summary.accruedByCurrency[0]).toMatchObject({ amountMinor: 6_500 });
    expect(summary.accruedByCurrency[0]!.currency).toBeTruthy();
  });

  it("returns zeroes for an empty estate rather than throwing", async () => {
    const summary = await getSubscriptionSummary();
    expect(summary).toMatchObject({ total: 0, serving: 0, attention: 0, byStatus: {} });
    expect(summary.accruedByCurrency).toEqual([]);
  });
});

describe("tenant settings — per-org IP allowlist", () => {
  beforeEach(reset);

  it("reads defaults for a tenant that has never saved anything", async () => {
    // A tenant that never opened the security page must behave exactly like one that
    // saved the defaults, not like one with an empty (deny-all) allowlist.
    expect(await getTenantSettings("never-seen")).toEqual({ ipAllowlistEnabled: false, ipAllowlist: [] });
  });

  it("round-trips a saved allowlist, scoped to one org", async () => {
    await putTenantSettings("acme", { ipAllowlistEnabled: true, ipAllowlist: ["203.0.113.0/24"] });

    expect(await getTenantSettings("acme")).toEqual({
      ipAllowlistEnabled: true,
      ipAllowlist: ["203.0.113.0/24"],
    });
    // Another org is unaffected — the key is the tenant, not a shared namespace.
    expect((await getTenantSettings("other")).ipAllowlistEnabled).toBe(false);
  });

  it("refuses to store a malformed entry", async () => {
    // A malformed entry matches nothing, so saving one into an enabled list would
    // deny every sign-in — a lockout caused by a typo.
    await expect(putTenantSettings("acme", { ipAllowlistEnabled: true, ipAllowlist: ["not-an-ip"] })).rejects.toThrow();
    await expect(
      putTenantSettings("acme", { ipAllowlistEnabled: true, ipAllowlist: ["203.0.113.0/99"] }),
    ).rejects.toThrow();
  });

  it("falls back to defaults when a stored row no longer parses", async () => {
    await query(`INSERT INTO tenant_settings (tenant_id, data) VALUES ($1, $2::jsonb)`, [
      "drifted",
      JSON.stringify({ ipAllowlistEnabled: "yes please" }),
    ]);

    // Read on the sign-in path: a row that drifted from the schema must not be able
    // to take the portal down.
    expect(await getTenantSettings("drifted")).toEqual({ ipAllowlistEnabled: false, ipAllowlist: [] });
  });
});

describe("subscription summary — stored vs enforced status", () => {
  beforeEach(reset);

  /** A trial subscription whose window closed a week ago, with no payment method. */
  const lapsedTrial = (tenantId: string) => {
    const sub = createSubscriptionFromPlan(tenantId, getPlan("starter")!);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return {
      ...sub,
      status: "trialing" as const,
      trial: {
        startedAt: new Date(weekAgo.getTime() - 24 * 60 * 60 * 1000),
        endsAt: weekAgo,
        documentsRemaining: null,
        maxPagesPerDocument: null,
        maxFileSizeBytes: null,
      },
      payment: { ...sub.payment, hasPaymentMethod: false },
    };
  };

  it("counts a lapsed trial as expired, not as serving", async () => {
    const sub = lapsedTrial("acme");
    // The record still *says* trialing — nothing rewrites it when the window closes.
    expect(sub.status).toBe("trialing");
    await putSubscription(sub);

    const summary = await getSubscriptionSummary();
    // ...but the entitlement checks already treat it as expired, so the console must
    // agree rather than reporting an enrolment the API is refusing.
    expect(summary.serving).toBe(0);
    expect(summary.byStatus).toMatchObject({ expired: 1 });
    expect(summary.byStatus.trialing).toBeUndefined();
  });

  it("still counts a live trial as serving", async () => {
    const sub = createSubscriptionFromPlan("acme", getPlan("starter")!);
    await putSubscription(sub);

    const summary = await getSubscriptionSummary();
    expect(summary.serving).toBe(1);
  });

  it("exposes both the stored and the derived status to readers", async () => {
    const view = toEffectiveSubscription(lapsedTrial("acme"));
    // Stored value stays visible so the drift is auditable rather than overwritten.
    expect(view.status).toBe("trialing");
    expect(view.effectiveStatus).toBe("expired");
  });
});
