import { purgeAuditEventsOlderThan, purgeDocumentsOlderThan } from "../observability/documents";
import { deleteDocuments } from "../storage/blob";
import { purgeDeliveriesOlderThan } from "../webhooks/store";
import { purgeRequestLogsOlderThan } from "../observability/request-log";
import { getSettings } from "../config/settings-store";
import { logger } from "../observability/logger";
import { getRedis } from "../redis";

/**
 * The retention sweep: deletes document records and audit events older than the
 * configured windows.
 *
 * Runs in the **worker** process, not the web one. Web replicas are sized for
 * request latency and are the ones a deploy restarts most; a periodic bulk `DELETE`
 * belongs beside the other background work instead.
 *
 * The policy is read fresh on every run (see `retentionSchema`), so an operator who
 * shortens a window sees the backlog trimmed on the next sweep rather than only new
 * rows aging out.
 */

/** How often the sweep runs. Retention is measured in days; hourly is ample. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Redis key holding the inter-replica lock. */
const LOCK_KEY = "retention:sweep:lock";
/**
 * Lock lifetime. Comfortably longer than a sweep, short enough that a worker killed
 * mid-sweep doesn't suppress the next few hours of them.
 */
const LOCK_TTL_SECONDS = 10 * 60;

export type SweepResult = {
  documents: number;
  auditEvents: number;
  /** Archived files removed from object storage alongside their rows. */
  blobs: number;
  /** Webhook delivery-log rows removed. */
  webhookDeliveries: number;
  /** Per-tenant API request-history rows removed. */
  requestLogs: number;
  skipped?: "disabled" | "locked";
};

/**
 * One sweep. Exported separately from the scheduler so it is directly testable and
 * so an operator can trigger it by hand.
 *
 * Takes the lock with `SET NX EX`: several worker replicas would otherwise all run
 * the same `DELETE` on the same hour. That is harmless for correctness (deleting an
 * already-deleted row is a no-op) but it is pure duplicated load on the database,
 * and the lock costs one round-trip. A Redis outage skips the sweep rather than
 * running it unguarded — retention is measured in days, so missing one hour is not
 * a problem worth risking a stampede over.
 */
export const runRetentionSweep = async (): Promise<SweepResult> => {
  const policy = await getSettings("retention");
  if (!policy.enabled)
    return { documents: 0, auditEvents: 0, blobs: 0, webhookDeliveries: 0, requestLogs: 0, skipped: "disabled" };

  let locked = false;
  try {
    locked = (await getRedis().set(LOCK_KEY, "1", "EX", LOCK_TTL_SECONDS, "NX")) === "OK";
  } catch (err) {
    logger.warn("retention.lock.unavailable — skipping sweep", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { documents: 0, auditEvents: 0, blobs: 0, webhookDeliveries: 0, requestLogs: 0, skipped: "locked" };
  }
  if (!locked)
    return { documents: 0, auditEvents: 0, blobs: 0, webhookDeliveries: 0, requestLogs: 0, skipped: "locked" };

  const { deleted: documents, storageKeys } = await purgeDocumentsOlderThan(policy.documentRetentionDays);
  // Rows first, then their files. In this order a crash in between leaves orphaned
  // objects, which a bucket lifecycle rule mops up; the reverse order would leave
  // rows advertising a download that 404s, which is the worse failure to explain.
  const blobs = await deleteDocuments(storageKeys);
  const auditEvents = await purgeAuditEventsOlderThan(policy.auditRetentionDays);
  // The delivery log follows the document window: it records what was sent about
  // documents, so outliving them would leave dangling references.
  const webhookDeliveries = await purgeDeliveriesOlderThan(policy.documentRetentionDays);
  // Request history follows the same window: it is the rolling record of activity a
  // tenant can see, and outliving the documents it describes would be incoherent.
  const requestLogs = await purgeRequestLogsOlderThan(policy.documentRetentionDays);

  // Always logged, including the zero case: "the sweep ran and found nothing" and
  // "the sweep never ran" look identical in a dashboard otherwise.
  logger.info("retention.swept", {
    documents,
    blobs,
    auditEvents,
    webhookDeliveries,
    requestLogs,
    documentRetentionDays: policy.documentRetentionDays,
    auditRetentionDays: policy.auditRetentionDays,
  });
  return { documents, auditEvents, blobs, webhookDeliveries, requestLogs };
};

/**
 * Starts the periodic sweep and returns a stop function.
 *
 * `unref()` keeps the timer from holding the process open on shutdown. The first
 * sweep is scheduled rather than immediate so a crash-looping worker can't turn
 * boot into a `DELETE` storm.
 */
export const startRetentionSweeper = (intervalMs = SWEEP_INTERVAL_MS): (() => void) => {
  const timer = setInterval(() => {
    runRetentionSweep().catch((err) =>
      logger.error("retention.sweep.failed", { err: err instanceof Error ? err.message : String(err) }),
    );
  }, intervalMs);
  timer.unref();

  logger.info("retention.sweeper.started", { intervalMs });
  return () => clearInterval(timer);
};
