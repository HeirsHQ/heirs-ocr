import { randomUUID } from "node:crypto";

import { actionLabel } from "./audit-labels";
import { logger } from "./logger";
import { query } from "../db";

/**
 * Durable audit trail, backed by the `audit_events` table (src/db.ts). Distinct
 * from the stdout log stream: these are the security-relevant *administrative*
 * actions (who changed which tenant / admin / plan / subscription / setting), kept
 * queryable so the console can render an audit-trail view and an operator can
 * answer "who did this".
 *
 * Recording never throws into the caller: an audit-store outage must not fail the
 * mutation it is recording — the row is best-effort and the failure is logged.
 */

export type AuditEvent = {
  id: string;
  /** Stable machine key (`tenant.revoked`) — what filters and alerts match on. */
  action: string;
  /** The same action as a sentence ("Revoked a tenant API key"), resolved on read. */
  actionLabel: string;
  actor: string;
  /** Who acted, by name — `Ada Obi (ada@x.com)`. Snapshotted when the event was recorded. */
  actorLabel: string | null;
  target: string | null;
  /** What was acted on, by name. Snapshotted, so it survives the target being deleted. */
  targetLabel: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type AuditRow = {
  id: string;
  action: string;
  actor: string;
  actor_label: string | null;
  target: string | null;
  target_label: string | null;
  metadata: unknown;
  created_at: Date;
};

const toEvent = (r: AuditRow): AuditEvent => ({
  id: r.id,
  action: r.action,
  actionLabel: actionLabel(r.action),
  actor: r.actor,
  actorLabel: r.actor_label,
  target: r.target,
  targetLabel: r.target_label,
  metadata: (r.metadata as Record<string, unknown>) ?? {},
  createdAt: r.created_at.toISOString(),
});

/**
 * Append one audit event. Best-effort: swallows store errors (logging them) so a
 * failed insert never breaks the administrative action being recorded.
 */
export const recordAuditEvent = async (input: {
  action: string;
  actor: string;
  /** Who acted, by name. Snapshotted — see the note on the columns in src/db.ts. */
  actorLabel?: string | null;
  target?: string | null;
  /** What was acted on, by name. Snapshotted for the same reason. */
  targetLabel?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  try {
    await query(
      `INSERT INTO audit_events (id, action, actor, actor_label, target, target_label, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        randomUUID(),
        input.action,
        input.actor,
        input.actorLabel ?? null,
        input.target ?? null,
        input.targetLabel ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  } catch (err) {
    logger.warn("audit.record.failed", {
      action: input.action,
      err: err instanceof Error ? err.message : String(err),
    });
  }
};

export type ListAuditOptions = { action?: string; actor?: string; limit?: number };

/** Builds the shared WHERE clause + bound params for both the page and its count. */
const auditFilter = (opts: Pick<ListAuditOptions, "action" | "actor">): { where: string; params: unknown[] } => {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.action) {
    params.push(`${opts.action}%`);
    clauses.push(`action LIKE $${params.length}`);
  }
  if (opts.actor) {
    params.push(opts.actor);
    clauses.push(`actor = $${params.length}`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
};

/** Most-recent-first audit events, optionally filtered by action prefix / actor. */
export const listAuditEvents = async (opts: ListAuditOptions = {}): Promise<AuditEvent[]> => {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const { where, params } = auditFilter(opts);
  params.push(limit);
  const { rows } = await query<AuditRow>(
    `SELECT id, action, actor, actor_label, target, target_label, metadata, created_at
       FROM audit_events
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length}`,
    params,
  );
  return rows.map(toEvent);
};

/**
 * One page of audit events plus the total matching the same filter.
 *
 * Paged in SQL rather than by slicing a full read: this is the only admin table that
 * grows without bound (one row per administrative mutation, forever), so loading it
 * whole to show 25 rows gets worse every day the service runs. The `COUNT(*)` runs
 * against the identical predicate, so `total` can never disagree with `items`.
 */
export const listAuditEventsPage = async (
  opts: Pick<ListAuditOptions, "action" | "actor"> & { page: number; pageSize: number },
): Promise<{ items: AuditEvent[]; total: number }> => {
  const { where, params } = auditFilter(opts);

  const counted = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM audit_events ${where}`, params);
  const total = Number(counted.rows[0]?.count ?? 0);

  const pageParams = [...params, opts.pageSize, (opts.page - 1) * opts.pageSize];
  const { rows } = await query<AuditRow>(
    `SELECT id, action, actor, actor_label, target, target_label, metadata, created_at
       FROM audit_events
       ${where}
       -- id breaks ties: several events can share a timestamp (one request that
       -- touches two tenants), and an unstable sort under LIMIT/OFFSET lets a row
       -- show up on two pages while another is never shown at all.
       ORDER BY created_at DESC, id DESC
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams,
  );
  return { items: rows.map(toEvent), total };
};
