import { randomBytes, randomUUID } from "crypto";

import type { WebhookEvent } from "./events";
import { logger } from "../observability/logger";
import { query } from "../db";

/**
 * Persistence for webhook endpoints and their delivery outbox.
 *
 * The deliveries table is both the queue and the log — see the note on the schema in
 * src/db.ts. Everything here is scoped by `tenant_id` in the statement rather than by
 * the caller remembering to filter, so one org can never read or mutate another's
 * endpoints.
 */

export type WebhookEndpoint = {
  id: string;
  tenantId: string;
  url: string;
  description: string | null;
  events: WebhookEvent[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** The endpoint plus its signing secret. Returned only at creation and on rotation. */
export type WebhookEndpointWithSecret = WebhookEndpoint & { secret: string };

type EndpointRow = {
  id: string;
  tenant_id: string;
  url: string;
  secret: string;
  description: string | null;
  events: WebhookEvent[] | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

const toEndpoint = (r: EndpointRow): WebhookEndpoint => ({
  id: r.id,
  tenantId: r.tenant_id,
  url: r.url,
  description: r.description,
  events: r.events ?? [],
  enabled: r.enabled,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * A fresh signing secret.
 *
 * Prefixed so it is recognisable in a receiver's config, and long enough that the
 * HMAC it keys cannot be brute-forced from observed signatures.
 */
export const generateSecret = (): string => `whsec_${randomBytes(32).toString("base64url")}`;

/**
 * How many endpoints one org may register.
 *
 * A cap exists because every endpoint multiplies the outbound fan-out of every
 * document this tenant processes — a hundred endpoints turns one OCR call into a
 * hundred third-party requests the worker has to make and retry. Ten is well past
 * any legitimate routing need (prod, staging, and a couple of internal consumers)
 * and far short of a number that hurts.
 */
export const MAX_ENDPOINTS_PER_TENANT = 10;

/** How many endpoints an org already has. Used to enforce {@link MAX_ENDPOINTS_PER_TENANT}. */
export const countEndpoints = async (tenantId: string): Promise<number> => {
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM webhook_endpoints WHERE tenant_id = $1`,
    [tenantId],
  );
  return Number(rows[0]?.count ?? 0);
};

export const listEndpoints = async (tenantId: string): Promise<WebhookEndpoint[]> => {
  const { rows } = await query<EndpointRow>(
    `SELECT * FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows.map(toEndpoint);
};

/** One endpoint, scoped to its org. `undefined` when it belongs to someone else. */
export const getEndpoint = async (tenantId: string, id: string): Promise<WebhookEndpoint | undefined> => {
  const { rows } = await query<EndpointRow>(`SELECT * FROM webhook_endpoints WHERE tenant_id = $1 AND id = $2`, [
    tenantId,
    id,
  ]);
  return rows[0] ? toEndpoint(rows[0]) : undefined;
};

export const createEndpoint = async (input: {
  tenantId: string;
  url: string;
  description?: string;
  events: WebhookEvent[];
}): Promise<WebhookEndpointWithSecret> => {
  const secret = generateSecret();
  const { rows } = await query<EndpointRow>(
    `INSERT INTO webhook_endpoints (id, tenant_id, url, secret, description, events, enabled)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, true)
     RETURNING *`,
    [randomUUID(), input.tenantId, input.url, secret, input.description ?? null, JSON.stringify(input.events)],
  );
  logger.info("webhook.endpoint.created", { tenantId: input.tenantId, endpointId: rows[0]!.id });
  return { ...toEndpoint(rows[0]!), secret };
};

export const updateEndpoint = async (
  tenantId: string,
  id: string,
  patch: { url?: string; description?: string | null; events?: WebhookEvent[]; enabled?: boolean },
): Promise<WebhookEndpoint | undefined> => {
  const { rows } = await query<EndpointRow>(
    `UPDATE webhook_endpoints SET
       url = COALESCE($3, url),
       description = COALESCE($4, description),
       events = COALESCE($5::jsonb, events),
       enabled = COALESCE($6, enabled),
       updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [
      tenantId,
      id,
      patch.url ?? null,
      patch.description ?? null,
      patch.events ? JSON.stringify(patch.events) : null,
      patch.enabled ?? null,
    ],
  );
  return rows[0] ? toEndpoint(rows[0]) : undefined;
};

/** Re-mints the signing secret. The old one stops working immediately. */
export const rotateSecret = async (tenantId: string, id: string): Promise<WebhookEndpointWithSecret | undefined> => {
  const secret = generateSecret();
  const { rows } = await query<EndpointRow>(
    `UPDATE webhook_endpoints SET secret = $3, updated_at = now()
     WHERE tenant_id = $1 AND id = $2
     RETURNING *`,
    [tenantId, id, secret],
  );
  if (!rows[0]) return undefined;
  logger.info("webhook.secret.rotated", { tenantId, endpointId: id });
  return { ...toEndpoint(rows[0]), secret };
};

export const deleteEndpoint = async (tenantId: string, id: string): Promise<boolean> => {
  const { rowCount } = await query(`DELETE FROM webhook_endpoints WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  // Pending deliveries are left to drain: the endpoint row is gone, so the worker
  // marks them dead on its next pass rather than silently discarding the history.
  return (rowCount ?? 0) > 0;
};

/** Endpoints in *any* org that are enabled and subscribed to `event`. Worker-side. */
export const endpointsForEvent = async (tenantId: string, event: WebhookEvent): Promise<WebhookEndpoint[]> => {
  const { rows } = await query<EndpointRow>(
    `SELECT * FROM webhook_endpoints
      WHERE tenant_id = $1 AND enabled = true AND events @> $2::jsonb`,
    [tenantId, JSON.stringify([event])],
  );
  return rows.map(toEndpoint);
};

// ── Deliveries ────────────────────────────────────────────────────────────────

export type DeliveryStatus = "pending" | "succeeded" | "dead";

export type WebhookDelivery = {
  id: string;
  endpointId: string;
  tenantId: string;
  event: string;
  status: DeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  nextAttemptAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type DeliveryRow = {
  id: string;
  endpoint_id: string;
  tenant_id: string;
  event: string;
  payload: unknown;
  status: string;
  attempts: number;
  response_status: number | null;
  last_error: string | null;
  next_attempt_at: Date;
  created_at: Date;
  updated_at: Date;
};

const toDelivery = (r: DeliveryRow): WebhookDelivery => ({
  id: r.id,
  endpointId: r.endpoint_id,
  tenantId: r.tenant_id,
  event: r.event,
  status: (["pending", "succeeded", "dead"] as const).includes(r.status as DeliveryStatus)
    ? (r.status as DeliveryStatus)
    : "pending",
  attempts: r.attempts,
  responseStatus: r.response_status,
  lastError: r.last_error,
  nextAttemptAt: r.next_attempt_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Queues one delivery. The id is generated here so it can go in the payload. */
export const enqueueDelivery = async (input: {
  id: string;
  endpointId: string;
  tenantId: string;
  event: string;
  payload: unknown;
}): Promise<void> => {
  await query(
    `INSERT INTO webhook_deliveries (id, endpoint_id, tenant_id, event, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [input.id, input.endpointId, input.tenantId, input.event, JSON.stringify(input.payload)],
  );
};

/** A delivery plus everything needed to send it — joined so the worker reads once. */
export type DueDelivery = {
  id: string;
  endpointId: string;
  tenantId: string;
  event: string;
  payload: unknown;
  attempts: number;
  url: string;
  secret: string;
};

/**
 * Claims up to `limit` deliveries that are due.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes this safe with several workers: each row is
 * handed to exactly one of them, and a worker that is still sending does not block
 * the others from picking up different rows. Without it two replicas would both send
 * the same delivery on every tick.
 *
 * A delivery whose endpoint has been deleted is not returned — it is swept separately
 * so the history records why it stopped rather than the row simply never firing.
 */
export const claimDueDeliveries = async (limit: number, now: Date = new Date()): Promise<DueDelivery[]> => {
  const { rows } = await query<DeliveryRow & { url: string; secret: string }>(
    `WITH due AS (
       SELECT d.id
         FROM webhook_deliveries d
         JOIN webhook_endpoints e ON e.id = d.endpoint_id
        WHERE d.status = 'pending' AND d.next_attempt_at <= $2 AND e.enabled = true
        ORDER BY d.next_attempt_at ASC
        LIMIT $1
        FOR UPDATE OF d SKIP LOCKED
     )
     UPDATE webhook_deliveries d
        SET attempts = d.attempts + 1, updated_at = now()
       FROM due, webhook_endpoints e
      WHERE d.id = due.id AND e.id = d.endpoint_id
      RETURNING d.*, e.url, e.secret`,
    [limit, now],
  );
  return rows.map((r) => ({
    id: r.id,
    endpointId: r.endpoint_id,
    tenantId: r.tenant_id,
    event: r.event,
    payload: r.payload,
    attempts: r.attempts,
    url: r.url,
    secret: r.secret,
  }));
};

export const markDelivered = async (id: string, responseStatus: number): Promise<void> => {
  await query(
    `UPDATE webhook_deliveries
        SET status = 'succeeded', response_status = $2, last_error = NULL, updated_at = now()
      WHERE id = $1`,
    [id, responseStatus],
  );
};

/** Schedules a retry, or gives up and marks the delivery dead. */
export const markFailed = async (input: {
  id: string;
  responseStatus?: number;
  error: string;
  retryAt?: Date;
}): Promise<void> => {
  if (input.retryAt) {
    await query(
      `UPDATE webhook_deliveries
          SET status = 'pending', response_status = $2, last_error = $3, next_attempt_at = $4, updated_at = now()
        WHERE id = $1`,
      [input.id, input.responseStatus ?? null, input.error.slice(0, 500), input.retryAt],
    );
    return;
  }
  await query(
    `UPDATE webhook_deliveries
        SET status = 'dead', response_status = $2, last_error = $3, updated_at = now()
      WHERE id = $1`,
    [input.id, input.responseStatus ?? null, input.error.slice(0, 500)],
  );
};

/**
 * Kills deliveries whose endpoint no longer exists.
 *
 * They would otherwise sit `pending` forever: the worker's claim joins the endpoint,
 * so a row with no endpoint is never picked up and never resolved. Marking them dead
 * records *why* they stopped instead of leaving an unexplained gap in the log.
 */
export const reapOrphanedDeliveries = async (): Promise<number> => {
  const { rowCount } = await query(
    `UPDATE webhook_deliveries d
        SET status = 'dead', last_error = 'Endpoint was deleted', updated_at = now()
      WHERE d.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM webhook_endpoints e WHERE e.id = d.endpoint_id)`,
  );
  return rowCount ?? 0;
};

/** One page of a tenant's delivery history, newest first. */
export const listDeliveriesPage = async (opts: {
  tenantId: string;
  endpointId?: string;
  page: number;
  pageSize: number;
}): Promise<{ items: WebhookDelivery[]; total: number }> => {
  const params: unknown[] = [opts.tenantId];
  let where = `WHERE tenant_id = $1`;
  if (opts.endpointId) {
    params.push(opts.endpointId);
    where += ` AND endpoint_id = $${params.length}`;
  }

  const counted = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM webhook_deliveries ${where}`,
    params,
  );
  const total = Number(counted.rows[0]?.count ?? 0);

  const paged = [...params, opts.pageSize, (opts.page - 1) * opts.pageSize];
  const { rows } = await query<DeliveryRow>(
    `SELECT * FROM webhook_deliveries
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${paged.length - 1} OFFSET $${paged.length}`,
    paged,
  );
  return { items: rows.map(toDelivery), total };
};

/** Retention sweep: deliveries are a log, not a permanent record. */
export const purgeDeliveriesOlderThan = async (retentionDays: number): Promise<number> => {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const { rowCount } = await query(`DELETE FROM webhook_deliveries WHERE created_at < $1`, [cutoff]);
  return rowCount ?? 0;
};
