import { randomUUID } from "node:crypto";

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
  action: string;
  actor: string;
  target: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type AuditRow = {
  id: string;
  action: string;
  actor: string;
  target: string | null;
  metadata: unknown;
  created_at: Date;
};

const toEvent = (r: AuditRow): AuditEvent => ({
  id: r.id,
  action: r.action,
  actor: r.actor,
  target: r.target,
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
  target?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  try {
    await query(
      `INSERT INTO audit_events (id, action, actor, target, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [randomUUID(), input.action, input.actor, input.target ?? null, JSON.stringify(input.metadata ?? {})],
    );
  } catch (err) {
    logger.warn("audit.record.failed", {
      action: input.action,
      err: err instanceof Error ? err.message : String(err),
    });
  }
};

export type ListAuditOptions = { action?: string; actor?: string; limit?: number };

/** Most-recent-first audit events, optionally filtered by action prefix / actor. */
export const listAuditEvents = async (opts: ListAuditOptions = {}): Promise<AuditEvent[]> => {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.action) {
    params.push(`${opts.action}%`);
    where.push(`action LIKE $${params.length}`);
  }
  if (opts.actor) {
    params.push(opts.actor);
    where.push(`actor = $${params.length}`);
  }
  params.push(limit);
  const { rows } = await query<AuditRow>(
    `SELECT id, action, actor, target, metadata, created_at
       FROM audit_events
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
    params,
  );
  return rows.map(toEvent);
};
