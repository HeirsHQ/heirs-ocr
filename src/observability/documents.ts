import { randomUUID } from "crypto";

import type { Sensitivity } from "../functions/define";
import { logger } from "./logger";
import { query } from "../db";

/**
 * Per-document processing registry — what the tenant portal's document list and
 * reports read.
 *
 * **This stores metadata, never content.** No file bytes, no extracted text, no
 * interpreted result: only what a tenant needs to answer "what did we send, when,
 * and did it work". The pipeline already has the document in memory; deliberately
 * not persisting it is the whole point.
 *
 * Functions classified `pii` or `restricted` are **not recorded at all** — see
 * {@link isRecordable}. That is stricter than redacting fields, because the
 * filename by itself is identifying (`jane-smith-passport.pdf`) and a row's mere
 * existence discloses that a named person was screened.
 *
 * Unlike `audit_events`, this table is swept: see src/jobs/retention.ts.
 */

/** The public shape of a recorded document. */
export type DocumentRecord = {
  id: string;
  tenantId: string;
  functionKey: string;
  fileName: string;
  byteSize: number;
  pageCount: number;
  outcome: "success" | "error";
  provider: string | null;
  tokensUsed: number | null;
  durationMs: number | null;
  createdAt: Date;
  /** Object-storage key for the archived file; `null` when the bytes were not kept. */
  storageKey: string | null;
};

type DocumentRow = {
  id: string;
  tenant_id: string;
  function_key: string;
  file_name: string;
  byte_size: string | number;
  page_count: number;
  outcome: string;
  provider: string | null;
  tokens_used: string | number | null;
  duration_ms: number | null;
  created_at: Date;
  storage_key: string | null;
};

// `bigint` comes back from pg as a string to avoid precision loss; these columns are
// counters that never approach 2^53, so narrowing them to number here is safe.
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

const toRecord = (r: DocumentRow): DocumentRecord => ({
  id: r.id,
  tenantId: r.tenant_id,
  functionKey: r.function_key,
  fileName: r.file_name,
  byteSize: Number(r.byte_size),
  pageCount: r.page_count,
  outcome: r.outcome === "error" ? "error" : "success",
  provider: r.provider,
  tokensUsed: num(r.tokens_used),
  durationMs: r.duration_ms,
  createdAt: r.created_at,
  storageKey: r.storage_key,
});

/**
 * Whether a function's output may be listed at all.
 *
 * The single gate for the privacy rule, exported so the decision is testable and
 * so no call site can quietly opt a sensitive function in.
 */
export const isRecordable = (sensitivity: Sensitivity): boolean => sensitivity === "standard";

export type RecordDocumentInput = {
  tenantId: string;
  functionKey: string;
  sensitivity: Sensitivity;
  fileName: string;
  byteSize: number;
  pageCount: number;
  outcome: "success" | "error";
  provider?: string | null;
  tokensUsed?: number | null;
  durationMs?: number | null;
  /** Set once the source file has been archived; omitted when storage is off. */
  storageKey?: string | null;
};

/**
 * Records one processed document. **No-ops for `pii`/`restricted` functions.**
 *
 * Fire-and-forget, like the usage counters (src/observability/usage.ts): a registry
 * write must never fail an OCR request that already succeeded, so a store outage is
 * logged and swallowed.
 *
 * Deliberately **not** an `async` function, matching `recordTenantUsage`. Inside an
 * `async` body a synchronous throw from `query` — which is what an unconfigured or
 * mocked db layer does — becomes a rejection settled on a later microtask, so the
 * warning surfaces after the caller has moved on. Catching synchronously keeps the
 * failure attributable to the request that caused it. The returned promise still
 * resolves once the insert lands, so callers that need the write (tests) can await
 * it while the pipeline ignores it.
 */
export const recordDocument = (input: RecordDocumentInput): Promise<void> => {
  if (!isRecordable(input.sensitivity)) return Promise.resolve();

  const warn = (err: unknown): void => {
    logger.warn("document.record.failed", {
      tenantId: input.tenantId,
      functionKey: input.functionKey,
      err: err instanceof Error ? err.message : String(err),
    });
  };

  try {
    return query(
      `INSERT INTO documents
         (id, tenant_id, function_key, file_name, byte_size, page_count, outcome, provider, tokens_used,
          duration_ms, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        randomUUID(),
        input.tenantId,
        input.functionKey,
        input.fileName,
        Math.max(0, Math.round(input.byteSize)),
        Math.max(0, Math.round(input.pageCount)),
        input.outcome,
        input.provider ?? null,
        input.tokensUsed ?? null,
        input.durationMs ?? null,
        input.storageKey ?? null,
      ],
    ).then(
      () => undefined,
      (err) => warn(err),
    );
  } catch (err) {
    warn(err);
    return Promise.resolve();
  }
};

export type ListDocumentsOptions = {
  tenantId?: string;
  functionKey?: string;
  outcome?: "success" | "error";
};

/** Shared WHERE clause + bound params, so the page and its COUNT can never diverge. */
const documentFilter = (opts: ListDocumentsOptions): { where: string; params: unknown[] } => {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.tenantId) {
    params.push(opts.tenantId);
    clauses.push(`tenant_id = $${params.length}`);
  }
  if (opts.functionKey) {
    params.push(opts.functionKey);
    clauses.push(`function_key = $${params.length}`);
  }
  if (opts.outcome) {
    params.push(opts.outcome);
    clauses.push(`outcome = $${params.length}`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
};

const COLUMNS = `id, tenant_id, function_key, file_name, byte_size, page_count, outcome, provider, tokens_used, duration_ms, created_at, storage_key`;

/**
 * One page of documents plus the total matching the same filter.
 *
 * Paged in SQL for the same reason as `audit_events`: one row per processed
 * document means a busy tenant's table outgrows any in-memory slice. `id` breaks
 * timestamp ties so a row can't appear on two pages while another is skipped.
 */
export const listDocumentsPage = async (
  opts: ListDocumentsOptions & { page: number; pageSize: number },
): Promise<{ items: DocumentRecord[]; total: number }> => {
  const { where, params } = documentFilter(opts);

  const counted = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM documents ${where}`, params);
  const total = Number(counted.rows[0]?.count ?? 0);

  const paged = [...params, opts.pageSize, (opts.page - 1) * opts.pageSize];
  const { rows } = await query<DocumentRow>(
    `SELECT ${COLUMNS}
       FROM documents
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${paged.length - 1} OFFSET $${paged.length}`,
    paged,
  );
  return { items: rows.map(toRecord), total };
};

/** The report the portal charts: totals, a per-function split, and a daily series. */
export type DocumentReport = {
  totals: { documents: number; pages: number; errors: number; bytes: number };
  byFunction: { functionKey: string; documents: number; pages: number; errors: number }[];
  daily: { date: string; documents: number; errors: number }[];
  /** Days covered by `daily`, echoed back so the chart can label its own window. */
  windowDays: number;
};

/**
 * Aggregates the registry for one tenant over a trailing window.
 *
 * Computed in SQL rather than by reading rows and reducing in Node: the whole point
 * of the report is to cover more documents than a page holds, so pulling them into
 * memory to count them would defeat it.
 */
export const getDocumentReport = async (tenantId: string, windowDays = 30): Promise<DocumentReport> => {
  const days = Math.min(Math.max(Math.round(windowDays), 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // `SUM(CASE ...)` rather than `COUNT(*) FILTER (...)`: both are correct Postgres,
  // but the aggregate-FILTER form is not portable to every engine the tests run
  // against, and the CASE form reads the same to anyone maintaining the query.
  const ERRORS = `COALESCE(SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END), 0)::text`;

  const totals = await query<{ documents: string; pages: string; errors: string; bytes: string }>(
    `SELECT COUNT(*)::text                     AS documents,
            COALESCE(SUM(page_count), 0)::text AS pages,
            ${ERRORS}                          AS errors,
            COALESCE(SUM(byte_size), 0)::text  AS bytes
       FROM documents
      WHERE tenant_id = $1 AND created_at >= $2`,
    [tenantId, since],
  );

  const byFunction = await query<{ function_key: string; documents: string; pages: string; errors: string }>(
    `SELECT function_key,
            COUNT(*)::text                     AS documents,
            COALESCE(SUM(page_count), 0)::text AS pages,
            ${ERRORS}                          AS errors
       FROM documents
      WHERE tenant_id = $1 AND created_at >= $2
      GROUP BY function_key
      ORDER BY COUNT(*) DESC`,
    [tenantId, since],
  );

  const daily = await query<{ date: string; documents: string; errors: string }>(
    // Grouped by the expression rather than by ordinal (`GROUP BY 1`): the ordinal
    // form silently re-binds if a column is ever inserted ahead of it.
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
            COUNT(*)::text                                       AS documents,
            ${ERRORS}                                            AS errors
       FROM documents
      WHERE tenant_id = $1 AND created_at >= $2
      GROUP BY date_trunc('day', created_at)
      ORDER BY date_trunc('day', created_at) ASC`,
    [tenantId, since],
  );

  const row = totals.rows[0];
  return {
    totals: {
      documents: Number(row?.documents ?? 0),
      pages: Number(row?.pages ?? 0),
      errors: Number(row?.errors ?? 0),
      bytes: Number(row?.bytes ?? 0),
    },
    byFunction: byFunction.rows.map((r) => ({
      functionKey: r.function_key,
      documents: Number(r.documents),
      pages: Number(r.pages),
      errors: Number(r.errors),
    })),
    daily: daily.rows.map((r) => ({ date: r.date, documents: Number(r.documents), errors: Number(r.errors) })),
    windowDays: days,
  };
};

/** One document by id, or `undefined`. The caller must check tenant ownership. */
export const getDocumentById = async (id: string): Promise<DocumentRecord | undefined> => {
  const { rows } = await query<DocumentRow>(`SELECT ${COLUMNS} FROM documents WHERE id = $1`, [id]);
  return rows[0] ? toRecord(rows[0]) : undefined;
};

/**
 * Deletes documents older than `retentionDays`, returning the count and the storage
 * keys that went with them.
 *
 * The keys are returned rather than dropped because the row is only the *index* —
 * the archived file lives in object storage, and deleting the row alone would leave
 * the document itself in the bucket forever while the console reported it purged.
 * The sweep (src/jobs/retention.ts) hands them to `deleteDocuments`.
 *
 * `DELETE ... RETURNING` rather than a SELECT-then-DELETE pair: the two-step version
 * races a concurrent sweep, and could return keys whose rows another replica already
 * removed.
 *
 * The cutoff is computed from the *current* policy at every sweep rather than being
 * stamped onto each row at insert. That way shortening the retention window applies
 * to documents already recorded, which is what an operator shortening it means —
 * a stored per-row expiry would leave the old backlog outliving the new policy.
 */
export const purgeDocumentsOlderThan = async (
  retentionDays: number,
): Promise<{ deleted: number; storageKeys: string[] }> => {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const { rows } = await query<{ storage_key: string | null }>(
    `DELETE FROM documents WHERE created_at < $1 RETURNING storage_key`,
    [cutoff],
  );
  return {
    deleted: rows.length,
    storageKeys: rows.map((r) => r.storage_key).filter((k): k is string => !!k),
  };
};

/** The same sweep for the audit trail, which has its own (longer) retention window. */
export const purgeAuditEventsOlderThan = async (retentionDays: number): Promise<number> => {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const { rowCount } = await query(`DELETE FROM audit_events WHERE created_at < $1`, [cutoff]);
  return rowCount ?? 0;
};
