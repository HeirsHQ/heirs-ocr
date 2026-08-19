import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The document registry (src/observability/documents.ts) and the retention sweep
 * (src/jobs/retention.ts), both against pg-mem so the real SQL runs.
 *
 * The privacy rule is the load-bearing part: a `pii`/`restricted` function must
 * leave no row at all, not merely a redacted one.
 */
const { query, resetDb, fakeRedis, strings, deletedKeys } = vi.hoisted(() => {
  const { newDb, DataType } = require("pg-mem") as typeof import("pg-mem");

  const DDL = `
    CREATE TABLE IF NOT EXISTS documents (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL,
      function_key text NOT NULL,
      file_name text NOT NULL,
      byte_size bigint NOT NULL DEFAULT 0,
      page_count integer NOT NULL DEFAULT 0,
      outcome text NOT NULL,
      provider text,
      tokens_used bigint,
      duration_ms integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      storage_key text
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
    CREATE TABLE IF NOT EXISTS request_logs (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL,
      request_id text,
      method text NOT NULL,
      path text NOT NULL,
      function_key text,
      status_code integer NOT NULL,
      error_code text,
      duration_ms integer,
      created_at timestamptz NOT NULL DEFAULT now()
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
    CREATE TABLE IF NOT EXISTS platform_settings (
      namespace text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `;

  /**
   * pg-mem ships only a small slice of Postgres's function library, and the daily
   * report needs two it lacks. Teaching the double about them keeps the production
   * SQL idiomatic Postgres rather than contorting the query to suit the fake.
   */
  const registerDateFunctions = (db: ReturnType<typeof newDb>): void => {
    db.public.registerFunction({
      name: "date_trunc",
      args: [DataType.text, DataType.timestamptz],
      returns: DataType.timestamptz,
      implementation: (_unit: string, d: Date) => {
        const day = new Date(d);
        day.setUTCHours(0, 0, 0, 0);
        return day;
      },
    });
    db.public.registerFunction({
      name: "to_char",
      args: [DataType.timestamptz, DataType.text],
      returns: DataType.text,
      // Only ever called with 'YYYY-MM-DD' here, so the format string is ignored.
      implementation: (d: Date) => new Date(d).toISOString().slice(0, 10),
    });
  };

  let mem = newDb();
  let pool = new (mem.adapters.createPg().Pool)();
  const query = vi.fn((text: string, params?: unknown[]) => pool.query(text, params));
  const resetDb = async () => {
    mem = newDb();
    registerDateFunctions(mem);
    pool = new (mem.adapters.createPg().Pool)();
    mem.public.none(DDL);
    query.mockReset();
    query.mockImplementation((text: string, params?: unknown[]) => pool.query(text, params));
  };

  const strings = new Map<string, string>();
  const fakeRedis = {
    // `SET key val EX n NX` returns "OK" only when the key was absent — the sweep
    // lock depends on exactly that.
    set: vi.fn(async (key: string, value: string, ..._rest: unknown[]) => {
      const nx = _rest.includes("NX");
      if (nx && strings.has(key)) return null;
      strings.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key: string) => strings.get(key) ?? null),
    del: vi.fn(async (key: string) => (strings.delete(key) ? 1 : 0)),
  };

  const deletedKeys: string[] = [];
  return { query, resetDb, fakeRedis, strings, deletedKeys };
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
// Object storage is exercised on its own in test/blob-storage.test.ts; here we only
// need to see that the sweep hands it the keys of the rows it deleted.
vi.mock("../src/storage/blob", () => ({
  deleteDocuments: async (keys: string[]) => {
    deletedKeys.push(...keys);
    return keys.length;
  },
}));

import {
  getDocumentReport,
  isRecordable,
  listDocumentsPage,
  purgeAuditEventsOlderThan,
  purgeDocumentsOlderThan,
  recordDocument,
  type RecordDocumentInput,
} from "../src/observability/documents";
import { runRetentionSweep } from "../src/jobs/retention";
import { listAuditEvents, recordAuditEvent } from "../src/observability/audit";
import { putSettings } from "../src/config/settings-store";

const reset = async () => {
  await resetDb();
  strings.clear();
  deletedKeys.length = 0;
};

const doc = (over: Partial<RecordDocumentInput> = {}): RecordDocumentInput => ({
  tenantId: "acme",
  functionKey: "TEXT_EXTRACTION",
  sensitivity: "standard",
  fileName: "invoice.pdf",
  byteSize: 2048,
  pageCount: 3,
  outcome: "success",
  provider: "azure",
  tokensUsed: 120,
  durationMs: 450,
  ...over,
});

/** Backdates a row so the age-based queries have something to bite on. */
const backdate = async (fileName: string, daysAgo: number) => {
  await query(`UPDATE documents SET created_at = $2 WHERE file_name = $1`, [
    fileName,
    new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
  ]);
};

// ── The privacy rule ──────────────────────────────────────────────────────────

describe("document registry — sensitivity", () => {
  beforeEach(reset);

  it("records only standard-sensitivity functions", () => {
    expect(isRecordable("standard")).toBe(true);
    expect(isRecordable("pii")).toBe(false);
    expect(isRecordable("restricted")).toBe(false);
  });

  it("writes no row at all for a pii function — not even a redacted one", async () => {
    await recordDocument(doc({ sensitivity: "pii", functionKey: "ID_VERIFICATION", fileName: "jane-passport.pdf" }));
    await recordDocument(doc({ sensitivity: "restricted", fileName: "sealed.pdf" }));

    const { rows } = await query(`SELECT * FROM documents`);
    // The filename alone identifies a person, and the row's existence discloses
    // that they were screened — so there must be nothing here, not a masked entry.
    expect(rows).toHaveLength(0);
  });

  it("records a standard function with its metadata, and never any content", async () => {
    await recordDocument(doc());

    const { items } = await listDocumentsPage({ tenantId: "acme", page: 1, pageSize: 25 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      tenantId: "acme",
      functionKey: "TEXT_EXTRACTION",
      fileName: "invoice.pdf",
      byteSize: 2048,
      pageCount: 3,
      outcome: "success",
      provider: "azure",
      tokensUsed: 120,
      durationMs: 450,
    });
    // The columns that would hold document text or bytes simply do not exist.
    const { rows } = await query(`SELECT * FROM documents`);
    const columns = Object.keys(rows[0] as object);
    expect(columns).not.toContain("content");
    expect(columns).not.toContain("text");
    expect(columns).not.toContain("result");
  });

  it("swallows a store failure rather than failing the request behind it", async () => {
    query.mockImplementationOnce(() => Promise.reject(new Error("db down")));
    // Fire-and-forget: an OCR call that already succeeded must not 500 on bookkeeping.
    await expect(recordDocument(doc())).resolves.toBeUndefined();
  });
});

// ── Listing ───────────────────────────────────────────────────────────────────

describe("document registry — listing", () => {
  beforeEach(reset);

  it("scopes to one tenant, newest first, and pages in SQL", async () => {
    for (let i = 0; i < 5; i++) await recordDocument(doc({ fileName: `a${i}.pdf` }));
    await recordDocument(doc({ tenantId: "other", fileName: "theirs.pdf" }));
    for (let i = 0; i < 5; i++) await backdate(`a${i}.pdf`, 5 - i);

    const first = await listDocumentsPage({ tenantId: "acme", page: 1, pageSize: 2 });
    expect(first.total).toBe(5);
    expect(first.items).toHaveLength(2);
    expect(first.items.map((d) => d.fileName)).toEqual(["a4.pdf", "a3.pdf"]);

    const second = await listDocumentsPage({ tenantId: "acme", page: 2, pageSize: 2 });
    expect(second.items.map((d) => d.fileName)).toEqual(["a2.pdf", "a1.pdf"]);

    // Another org's row is never in the count or the page.
    expect(first.items.every((d) => d.tenantId === "acme")).toBe(true);
  });

  it("filters by function and outcome, with total matching the same predicate", async () => {
    await recordDocument(doc({ fileName: "ok.pdf" }));
    await recordDocument(doc({ fileName: "bad.pdf", outcome: "error" }));
    await recordDocument(doc({ fileName: "receipt.pdf", functionKey: "RECEIPT_PARSING" }));

    const errors = await listDocumentsPage({ tenantId: "acme", outcome: "error", page: 1, pageSize: 25 });
    expect(errors.total).toBe(1);
    expect(errors.items[0]!.fileName).toBe("bad.pdf");

    const receipts = await listDocumentsPage({
      tenantId: "acme",
      functionKey: "RECEIPT_PARSING",
      page: 1,
      pageSize: 25,
    });
    expect(receipts.total).toBe(1);
    expect(receipts.items[0]!.fileName).toBe("receipt.pdf");
  });
});

// ── Reports ───────────────────────────────────────────────────────────────────

describe("document reports", () => {
  beforeEach(reset);

  it("aggregates totals, a per-function split, and a daily series", async () => {
    await recordDocument(doc({ fileName: "a.pdf", pageCount: 2, byteSize: 100 }));
    await recordDocument(doc({ fileName: "b.pdf", pageCount: 3, byteSize: 200, outcome: "error" }));
    await recordDocument(doc({ fileName: "c.pdf", pageCount: 5, byteSize: 300, functionKey: "RECEIPT_PARSING" }));

    const report = await getDocumentReport("acme", 30);
    expect(report.totals).toEqual({ documents: 3, pages: 10, errors: 1, bytes: 600 });
    expect(report.windowDays).toBe(30);

    const text = report.byFunction.find((f) => f.functionKey === "TEXT_EXTRACTION");
    expect(text).toMatchObject({ documents: 2, pages: 5, errors: 1 });
    expect(report.byFunction.find((f) => f.functionKey === "RECEIPT_PARSING")).toMatchObject({
      documents: 1,
      pages: 5,
    });

    expect(report.daily).toHaveLength(1);
    expect(report.daily[0]).toMatchObject({ documents: 3, errors: 1 });
  });

  it("excludes documents older than the requested window", async () => {
    await recordDocument(doc({ fileName: "recent.pdf" }));
    await recordDocument(doc({ fileName: "ancient.pdf" }));
    await backdate("ancient.pdf", 60);

    expect((await getDocumentReport("acme", 30)).totals.documents).toBe(1);
    expect((await getDocumentReport("acme", 90)).totals.documents).toBe(2);
  });

  it("reports zeroes rather than throwing for a tenant with no history", async () => {
    const report = await getDocumentReport("nobody", 30);
    expect(report.totals).toEqual({ documents: 0, pages: 0, errors: 0, bytes: 0 });
    expect(report.byFunction).toEqual([]);
    expect(report.daily).toEqual([]);
  });
});

// ── Retention ─────────────────────────────────────────────────────────────────

describe("retention purge", () => {
  beforeEach(reset);

  it("deletes only documents past the window", async () => {
    await recordDocument(doc({ fileName: "fresh.pdf" }));
    await recordDocument(doc({ fileName: "stale.pdf" }));
    await backdate("stale.pdf", 100);

    expect(await purgeDocumentsOlderThan(90)).toMatchObject({ deleted: 1 });
    const { items } = await listDocumentsPage({ tenantId: "acme", page: 1, pageSize: 25 });
    expect(items.map((d) => d.fileName)).toEqual(["fresh.pdf"]);
  });

  it("applies a shortened window to documents already stored", async () => {
    await recordDocument(doc({ fileName: "old.pdf" }));
    await backdate("old.pdf", 40);

    // Nothing to do at the default window...
    expect(await purgeDocumentsOlderThan(90)).toMatchObject({ deleted: 0 });
    // ...but shortening it must reach back into the existing backlog, which a
    // per-row expiry stamped at insert would not have done.
    expect(await purgeDocumentsOlderThan(30)).toMatchObject({ deleted: 1 });
  });

  it("stores the actor and target names alongside the ids", async () => {
    await recordAuditEvent({
      action: "tenant.revoked",
      actor: "admin-uuid",
      actorLabel: "Ada Obi (ada@x.com)",
      target: "sha256hash",
      targetLabel: "Acme Corp (acme)",
    });

    const [event] = await listAuditEvents();
    // The ids stay machine-stable; the labels are what a person reads. The action
    // label is resolved on read, the target label was snapshotted on write.
    expect(event).toMatchObject({
      action: "tenant.revoked",
      actionLabel: "Revoked a tenant API key",
      actor: "admin-uuid",
      actorLabel: "Ada Obi (ada@x.com)",
      target: "sha256hash",
      targetLabel: "Acme Corp (acme)",
    });
  });

  it("keeps the target's name after the target itself is gone", async () => {
    await recordAuditEvent({
      action: "admin.deleted",
      actor: "admin-uuid",
      actorLabel: "Ada Obi (ada@x.com)",
      target: "deleted-user-uuid",
      targetLabel: "Bola Ade (bola@x.com)",
    });

    // Deletion is exactly the case where a join at read time would render "unknown".
    const [event] = await listAuditEvents();
    expect(event!.targetLabel).toBe("Bola Ade (bola@x.com)");
    expect(event!.actionLabel).toBe("Deleted an admin user");
  });

  it("purges audit events on their own window", async () => {
    await recordAuditEvent({ action: "admin.created", actor: "someone" });
    await query(`UPDATE audit_events SET created_at = $1`, [new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)]);

    expect(await purgeAuditEventsOlderThan(365)).toBe(1);
  });
});

describe("retention sweep", () => {
  beforeEach(reset);

  it("sweeps both tables using the stored policy", async () => {
    await putSettings("retention", { enabled: true, documentRetentionDays: 30, auditRetentionDays: 60 });

    await recordDocument(doc({ fileName: "old.pdf" }));
    await backdate("old.pdf", 45);
    await recordDocument(doc({ fileName: "new.pdf" }));
    await recordAuditEvent({ action: "admin.created", actor: "someone" });
    await query(`UPDATE audit_events SET created_at = $1`, [new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)]);

    expect(await runRetentionSweep()).toEqual({
      documents: 1,
      auditEvents: 1,
      blobs: 0,
      webhookDeliveries: 0,
      requestLogs: 0,
    });
    const { items } = await listDocumentsPage({ tenantId: "acme", page: 1, pageSize: 25 });
    expect(items.map((d) => d.fileName)).toEqual(["new.pdf"]);
  });

  it("does nothing when retention is switched off", async () => {
    await putSettings("retention", { enabled: false, documentRetentionDays: 1, auditRetentionDays: 1 });
    await recordDocument(doc({ fileName: "old.pdf" }));
    await backdate("old.pdf", 500);

    expect(await runRetentionSweep()).toEqual({
      documents: 0,
      auditEvents: 0,
      blobs: 0,
      webhookDeliveries: 0,
      requestLogs: 0,
      skipped: "disabled",
    });
    expect((await listDocumentsPage({ tenantId: "acme", page: 1, pageSize: 25 })).total).toBe(1);
  });

  it("only one replica sweeps per window — the second finds the lock held", async () => {
    await putSettings("retention", { enabled: true, documentRetentionDays: 30, auditRetentionDays: 60 });
    await recordDocument(doc({ fileName: "old.pdf" }));
    await backdate("old.pdf", 45);

    expect(await runRetentionSweep()).toEqual({
      documents: 1,
      auditEvents: 0,
      blobs: 0,
      webhookDeliveries: 0,
      requestLogs: 0,
    });
    // A second worker on the same hour must not re-run the bulk DELETE.
    expect(await runRetentionSweep()).toEqual({
      documents: 0,
      auditEvents: 0,
      blobs: 0,
      webhookDeliveries: 0,
      requestLogs: 0,
      skipped: "locked",
    });
  });

  it("deletes archived files alongside the rows they index", async () => {
    await putSettings("retention", { enabled: true, documentRetentionDays: 30, auditRetentionDays: 60 });
    await recordDocument(doc({ fileName: "old.pdf", storageKey: "documents/acme/2020-01-01/x/old.pdf" }));
    await recordDocument(doc({ fileName: "kept.pdf", storageKey: "documents/acme/2020-01-01/y/kept.pdf" }));
    await backdate("old.pdf", 45);

    const result = await runRetentionSweep();
    // The row is only the index — deleting it alone would leave the document sitting
    // in the bucket forever while the console reported it purged.
    expect(result).toMatchObject({ documents: 1, blobs: 1 });
    expect(deletedKeys).toEqual(["documents/acme/2020-01-01/x/old.pdf"]);
  });

  it("skips the sweep when Redis is unavailable rather than running unguarded", async () => {
    await putSettings("retention", { enabled: true, documentRetentionDays: 30, auditRetentionDays: 60 });
    fakeRedis.set.mockRejectedValueOnce(new Error("redis down"));

    expect(await runRetentionSweep()).toEqual({
      documents: 0,
      auditEvents: 0,
      blobs: 0,
      webhookDeliveries: 0,
      requestLogs: 0,
      skipped: "locked",
    });
  });
});
