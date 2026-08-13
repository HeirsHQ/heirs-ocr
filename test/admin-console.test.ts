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
    CREATE TABLE IF NOT EXISTS audit_events (
      id uuid PRIMARY KEY,
      action text NOT NULL,
      actor text NOT NULL,
      target text,
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
import { listAuditEvents, recordAuditEvent } from "../src/observability/audit";
import { captureLog, recentLogs } from "../src/observability/log-buffer";
import { createBackup, getBackup, listBackups, restoreBackup } from "../src/ops/backups";

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
