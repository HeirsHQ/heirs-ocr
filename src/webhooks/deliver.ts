import { SIGNATURE_HEADER, signPayload } from "./signing";
import { claimDueDeliveries, markDelivered, markFailed, reapOrphanedDeliveries, type DueDelivery } from "./store";
import { logger } from "../observability/logger";

/**
 * The delivery worker: drains the webhook outbox.
 *
 * Runs in the worker process beside the retention sweep, for the same reason — it is
 * background I/O against third-party hosts, and a slow receiver must never be able to
 * occupy a web replica that is serving OCR requests.
 *
 * Retries use exponential backoff over a bounded number of attempts, after which the
 * delivery is marked `dead` rather than retried forever. A receiver that has been
 * down for hours is not coming back within this delivery's usefulness, and an
 * unbounded queue of retries against a dead host is how a webhook system turns into
 * an outage of its own.
 */

/** How often the outbox is drained. */
export const POLL_INTERVAL_MS = 10_000;
/** Deliveries claimed per tick. Bounds concurrent outbound requests per worker. */
const BATCH_SIZE = 20;
/** Total attempts before a delivery is declared dead. */
export const MAX_ATTEMPTS = 6;
/** First retry delay; doubles each attempt (10s, 20s, 40s, 80s, 160s). */
const BASE_BACKOFF_MS = 10_000;
/**
 * Per-request ceiling. Deliberately short: a receiver that cannot answer in ten
 * seconds is failing, and holding the connection open only delays the rest of the
 * batch behind it.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** Delay before attempt `n` (1-based), doubling each time. */
export const backoffMs = (attempts: number): number => BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);

/**
 * A 2xx is success. Everything else retries — including 4xx.
 *
 * Not distinguishing them is deliberate: a 404 or 401 from a receiver is most often a
 * deploy in progress or a rotated secret the tenant is about to fix, and giving up
 * immediately would drop events they could have had. The attempt ceiling is what
 * bounds it.
 */
const isSuccess = (status: number): boolean => status >= 200 && status < 300;

const attempt = async (delivery: DueDelivery): Promise<void> => {
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(delivery.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADER]: signPayload(body, delivery.secret, timestamp),
        // Lets a receiver dedupe: a retry carries the same delivery id.
        "X-Heirs-Delivery": delivery.id,
        "X-Heirs-Event": delivery.event,
        "user-agent": "Heirs-OCR-Webhooks/1.0",
      },
      body,
      signal: controller.signal,
      redirect: "manual",
    });

    if (isSuccess(res.status)) {
      await markDelivered(delivery.id, res.status);
      return;
    }

    await failOrRetry(delivery, `Receiver responded ${res.status}`, res.status);
  } catch (err) {
    const message = controller.signal.aborted
      ? `No response within ${REQUEST_TIMEOUT_MS}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    await failOrRetry(delivery, message);
  } finally {
    clearTimeout(timer);
  }
};

const failOrRetry = async (delivery: DueDelivery, error: string, responseStatus?: number): Promise<void> => {
  // `attempts` was already incremented when the row was claimed, so it counts this try.
  if (delivery.attempts >= MAX_ATTEMPTS) {
    await markFailed({ id: delivery.id, responseStatus, error });
    logger.warn("webhook.delivery.dead", {
      deliveryId: delivery.id,
      tenantId: delivery.tenantId,
      attempts: delivery.attempts,
      error,
    });
    return;
  }
  await markFailed({
    id: delivery.id,
    responseStatus,
    error,
    retryAt: new Date(Date.now() + backoffMs(delivery.attempts)),
  });
};

export type DrainResult = { attempted: number; orphansReaped: number };

/**
 * One pass over the outbox. Exported separately from the scheduler so it is directly
 * testable and can be triggered by hand.
 *
 * Deliveries in a batch run concurrently — they go to unrelated hosts, so one slow
 * receiver should not hold up the rest. `BATCH_SIZE` is what bounds that fan-out.
 */
export const drainWebhookOutbox = async (now: Date = new Date()): Promise<DrainResult> => {
  const orphansReaped = await reapOrphanedDeliveries();
  const due = await claimDueDeliveries(BATCH_SIZE, now);
  if (due.length === 0) return { attempted: 0, orphansReaped };

  await Promise.all(due.map(attempt));
  return { attempted: due.length, orphansReaped };
};

/**
 * Starts the poller and returns a stop function. `unref()` keeps the timer from
 * holding the process open on shutdown.
 */
export const startWebhookDelivery = (intervalMs = POLL_INTERVAL_MS): (() => void) => {
  const timer = setInterval(() => {
    drainWebhookOutbox().catch((err) =>
      logger.error("webhook.drain.failed", { err: err instanceof Error ? err.message : String(err) }),
    );
  }, intervalMs);
  timer.unref();

  logger.info("webhook.delivery.started", { intervalMs });
  return () => clearInterval(timer);
};
