import { randomUUID } from "crypto";

import { logger } from "./logger";
import { query } from "../db";

/**
 * Per-tenant API request history — what the portal's Logs page reads.
 *
 * Distinct from two things it could be confused with:
 *
 *  - The **platform log ring buffer** (src/observability/log-buffer.ts) is
 *    operator-facing, spans every tenant, and carries internal detail. It could never
 *    be shown to a tenant.
 *  - The **document registry** (src/observability/documents.ts) records documents that
 *    were actually processed. This records *requests*, so it also holds the calls that
 *    never became documents — a 402 over quota, a 429, an unsupported file type. Those
 *    are precisely what someone debugging an integration is looking for, and they are
 *    invisible everywhere else.
 *
 * No request or response body is stored: method, path, outcome, and duration only.
 */

export type RequestLogEntry = {
  id: string;
  tenantId: string;
  requestId: string | null;
  method: string;
  path: string;
  functionKey: string | null;
  statusCode: number;
  errorCode: string | null;
  durationMs: number | null;
  createdAt: Date;
};

type Row = {
  id: string;
  tenant_id: string;
  request_id: string | null;
  method: string;
  path: string;
  function_key: string | null;
  status_code: number;
  error_code: string | null;
  duration_ms: number | null;
  created_at: Date;
};

const toEntry = (r: Row): RequestLogEntry => ({
  id: r.id,
  tenantId: r.tenant_id,
  requestId: r.request_id,
  method: r.method,
  path: r.path,
  functionKey: r.function_key,
  statusCode: r.status_code,
  errorCode: r.error_code,
  durationMs: r.duration_ms,
  createdAt: r.created_at,
});

export type RecordRequestInput = {
  tenantId: string;
  requestId?: string;
  method: string;
  path: string;
  functionKey?: string;
  statusCode: number;
  errorCode?: string;
  durationMs?: number;
};

/**
 * Records one API request.
 *
 * Fire-and-forget, and deliberately **not** an `async` function — the same reasoning
 * as `recordDocument`: inside an async body a synchronous throw from `query` becomes
 * a rejection settled on a later microtask, so the warning surfaces after the request
 * has finished and cannot be attributed to it. The returned promise still resolves
 * once the insert lands, so tests can await it.
 *
 * This runs on every OCR call, so it is one small insert on the hot path. That is
 * affordable against requests measured in seconds; if it ever stops being, the fix is
 * to batch here rather than to drop the feature.
 */
export const recordApiRequest = (input: RecordRequestInput): Promise<void> => {
  const warn = (err: unknown): void => {
    logger.warn("request_log.record.failed", {
      tenantId: input.tenantId,
      err: err instanceof Error ? err.message : String(err),
    });
  };

  try {
    return query(
      `INSERT INTO request_logs
         (id, tenant_id, request_id, method, path, function_key, status_code, error_code, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        randomUUID(),
        input.tenantId,
        input.requestId ?? null,
        input.method,
        // Bounded: the path is caller-controlled and lands in a row.
        input.path.slice(0, 300),
        input.functionKey ?? null,
        input.statusCode,
        input.errorCode ?? null,
        input.durationMs ?? null,
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

export type ListRequestLogOptions = {
  tenantId: string;
  functionKey?: string;
  /** `success` = 2xx, `error` = everything else. The distinction people actually want. */
  outcome?: "success" | "error";
};

const filterFor = (opts: ListRequestLogOptions): { where: string; params: unknown[] } => {
  const params: unknown[] = [opts.tenantId];
  let where = `WHERE tenant_id = $1`;
  if (opts.functionKey) {
    params.push(opts.functionKey);
    where += ` AND function_key = $${params.length}`;
  }
  if (opts.outcome === "success") where += ` AND status_code < 400`;
  if (opts.outcome === "error") where += ` AND status_code >= 400`;
  return { where, params };
};

/**
 * One page of a tenant's request history, newest first.
 *
 * Paged in SQL: one row per API call is the fastest-growing table a tenant owns, so
 * an in-memory slice would degrade with every request they make.
 */
export const listRequestLogsPage = async (
  opts: ListRequestLogOptions & { page: number; pageSize: number },
): Promise<{ items: RequestLogEntry[]; total: number }> => {
  const { where, params } = filterFor(opts);

  const counted = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM request_logs ${where}`, params);
  const total = Number(counted.rows[0]?.count ?? 0);

  const paged = [...params, opts.pageSize, (opts.page - 1) * opts.pageSize];
  const { rows } = await query<Row>(
    `SELECT * FROM request_logs
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${paged.length - 1} OFFSET $${paged.length}`,
    paged,
  );
  return { items: rows.map(toEntry), total };
};

/** Retention sweep: request logs are a rolling history, not a permanent record. */
export const purgeRequestLogsOlderThan = async (retentionDays: number): Promise<number> => {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const { rowCount } = await query(`DELETE FROM request_logs WHERE created_at < $1`, [cutoff]);
  return rowCount ?? 0;
};

/** One tenant's volume on one function, over the retained log window. */
export type TenantFunctionUsage = {
  tenantId: string;
  functionKey: string;
  requests: number;
  errors: number;
};

/**
 * Requests per tenant per function, busiest first.
 *
 * Sourced from `request_logs` because it is the only place carrying both dimensions:
 * `tenant_usage` is keyed by tenant and `function_usage` by function, and neither can
 * be crossed after the fact. Two consequences the console has to state rather than
 * hide:
 *
 *  - **It is a rolling window, not a lifetime total.** These rows age out with the
 *    retention sweep (`purgeRequestLogsOlderThan`), so this will read lower than the
 *    lifetime counters once logs start expiring.
 *  - **It counts refused calls.** The log is written above `auth` in the chain, so a
 *    429 or a 402 that never reached the pipeline is a row here but was never a
 *    request as far as `tenant_usage` is concerned. That is the point of the table —
 *    it is what someone debugging an integration needs — but it means this can read
 *    *higher* than the lifetime counters over the same period.
 *
 * `function_key IS NULL` rows are dropped: the catalog and job-status endpoints are
 * not function runs and would otherwise appear as a nameless row per tenant.
 */
export const getTenantFunctionUsage = async (): Promise<TenantFunctionUsage[]> => {
  const { rows } = await query<{
    tenant_id: string;
    function_key: string;
    requests: string;
    errors: string;
  }>(
    `SELECT tenant_id,
            function_key,
            COUNT(*)::text                                  AS requests,
            COUNT(*) FILTER (WHERE status_code >= 400)::text AS errors
       FROM request_logs
      WHERE function_key IS NOT NULL
      GROUP BY tenant_id, function_key
      ORDER BY COUNT(*) DESC, tenant_id ASC, function_key ASC`,
  );
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    functionKey: r.function_key,
    requests: Number(r.requests),
    errors: Number(r.errors),
  }));
};
