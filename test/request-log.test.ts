import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

/**
 * The per-tenant API request history and the middleware that fills it.
 *
 * The behaviour that matters is what gets recorded when a request is *refused*: those
 * calls never become documents, so this log is the only place a tenant can see them.
 */
const { query, resetDb } = vi.hoisted(() => {
  const { newDb } = require("pg-mem") as typeof import("pg-mem");

  const DDL = `
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

import { listRequestLogsPage, purgeRequestLogsOlderThan, recordApiRequest } from "../src/observability/request-log";
import { requestLog } from "../src/http/middleware/request-log";

beforeEach(resetDb);

const entry = (over: Partial<Parameters<typeof recordApiRequest>[0]> = {}) => ({
  tenantId: "acme",
  method: "POST",
  path: "/v1/ocr/TEXT_EXTRACTION",
  functionKey: "TEXT_EXTRACTION",
  statusCode: 200,
  durationMs: 120,
  ...over,
});

const listFor = (tenantId = "acme", over: Record<string, unknown> = {}) =>
  listRequestLogsPage({ tenantId, page: 1, pageSize: 25, ...over });

// ── Store ─────────────────────────────────────────────────────────────────────

describe("request log store", () => {
  it("records a call and scopes reads to one org", async () => {
    await recordApiRequest(entry());
    await recordApiRequest(entry({ tenantId: "other" }));

    const mine = await listFor();
    expect(mine.total).toBe(1);
    expect(mine.items[0]).toMatchObject({
      tenantId: "acme",
      method: "POST",
      functionKey: "TEXT_EXTRACTION",
      statusCode: 200,
      durationMs: 120,
    });
  });

  it("records refusals — the calls that never became documents", async () => {
    await recordApiRequest(entry({ statusCode: 402, errorCode: "PAYMENT_REQUIRED" }));
    await recordApiRequest(entry({ statusCode: 429, errorCode: "QUOTA_EXCEEDED" }));

    const errors = await listFor("acme", { outcome: "error" });
    expect(errors.total).toBe(2);
    expect(errors.items.map((e) => e.errorCode).sort()).toEqual(["PAYMENT_REQUIRED", "QUOTA_EXCEEDED"]);
  });

  it("splits success from error on the status class, not the error code", async () => {
    await recordApiRequest(entry({ statusCode: 200 }));
    await recordApiRequest(entry({ statusCode: 202 }));
    await recordApiRequest(entry({ statusCode: 500, errorCode: "INTERNAL" }));

    expect((await listFor("acme", { outcome: "success" })).total).toBe(2);
    expect((await listFor("acme", { outcome: "error" })).total).toBe(1);
  });

  it("filters by function", async () => {
    await recordApiRequest(entry());
    await recordApiRequest(entry({ functionKey: "RECEIPT_PARSING" }));

    expect((await listFor("acme", { functionKey: "RECEIPT_PARSING" })).total).toBe(1);
  });

  it("bounds a hostile path rather than storing it whole", async () => {
    await recordApiRequest(entry({ path: `/v1/ocr/${"x".repeat(2_000)}` }));
    expect((await listFor()).items[0]!.path.length).toBeLessThanOrEqual(300);
  });

  it("swallows a store failure rather than affecting the request behind it", async () => {
    query.mockImplementationOnce(() => Promise.reject(new Error("db down")));
    await expect(recordApiRequest(entry())).resolves.toBeUndefined();
  });

  it("purges only entries past the retention window", async () => {
    await recordApiRequest(entry({ requestId: "keep" }));
    await recordApiRequest(entry({ requestId: "drop" }));
    await query(`UPDATE request_logs SET created_at = $1 WHERE request_id = 'drop'`, [
      new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
    ]);

    expect(await purgeRequestLogsOlderThan(90)).toBe(1);
    expect((await listFor()).items[0]!.requestId).toBe("keep");
  });
});

// ── Middleware ────────────────────────────────────────────────────────────────

describe("request-log middleware", () => {
  /** A minimal Express double: enough to drive `res.json` and the `finish` hook. */
  const drive = async (opts: { tenantId?: string; method?: string; path?: string; status: number; body?: unknown }) => {
    const listeners: (() => void)[] = [];
    const req = {
      method: opts.method ?? "POST",
      path: opts.path ?? "/TEXT_EXTRACTION",
      originalUrl: `/v1/ocr${opts.path ?? "/TEXT_EXTRACTION"}?debug=1`,
      url: `/v1/ocr${opts.path ?? "/TEXT_EXTRACTION"}`,
      params: {},
      requestId: "req_1",
      tenantId: opts.tenantId,
    } as unknown as Request;
    const res = {
      statusCode: opts.status,
      json: (body: unknown) => body,
      on: (event: string, fn: () => void) => {
        if (event === "finish") listeners.push(fn);
      },
    } as unknown as Response;

    const next = vi.fn() as unknown as NextFunction;
    requestLog(req, res, next);
    if (opts.body !== undefined) res.json(opts.body);
    listeners.forEach((fn) => fn());
    // The insert is fired off the finish hook; let the microtask land.
    await new Promise((resolve) => setImmediate(resolve));
    return { next };
  };

  it("records a successful call and passes the request along", async () => {
    const { next } = await drive({ tenantId: "acme", status: 200 });
    expect(next).toHaveBeenCalled();

    const { items } = await listFor();
    expect(items[0]).toMatchObject({ statusCode: 200, functionKey: "TEXT_EXTRACTION", requestId: "req_1" });
  });

  it("captures the error code from the typed envelope", async () => {
    // Every denial path renders through res.json, so wrapping it once catches them
    // all — including guards that refuse before the handler ever runs.
    await drive({
      tenantId: "acme",
      status: 429,
      body: { error: { code: "QUOTA_EXCEEDED", message: "over quota" } },
    });

    expect((await listFor()).items[0]).toMatchObject({ statusCode: 429, errorCode: "QUOTA_EXCEEDED" });
  });

  it("strips the query string from the recorded path", async () => {
    await drive({ tenantId: "acme", status: 200 });
    // A query can carry parameters that are not ours to keep; the path identifies the call.
    expect((await listFor()).items[0]!.path).toBe("/v1/ocr/TEXT_EXTRACTION");
  });

  it("records nothing when the request never authenticated", async () => {
    // There is no tenant to attribute it to, and guessing from a rejected key would
    // be worse than the gap.
    await drive({ status: 401, body: { error: { code: "UNAUTHORIZED", message: "no" } } });
    expect((await listFor()).total).toBe(0);
  });

  it("leaves the catalog and job-status routes without a function key", async () => {
    await drive({ tenantId: "acme", method: "GET", path: "/functions", status: 200 });
    await drive({ tenantId: "acme", method: "GET", path: "/jobs/abc", status: 200 });

    const { items } = await listFor();
    expect(items).toHaveLength(2);
    expect(items.every((e) => e.functionKey === null)).toBe(true);
  });
});
