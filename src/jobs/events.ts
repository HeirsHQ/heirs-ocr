import { QueueEvents } from "bullmq";

import { createQueueConnection, OCR_QUEUE_NAME, ocrQueue, type JobRecord } from "./queue";
import { logger } from "../observability/logger";

/**
 * Push notification of job state changes, so the consoles stop polling for them.
 *
 * Polling could not see the transitions it existed to show. A job that starts
 * promptly sits in `queued` for barely a second, which a 5s poll never samples — the
 * page went from "nothing" to "failed" with the interesting part invisible in
 * between. Tightening the interval would only narrow the window rather than close
 * it, and would multiply the cost across every idle tab.
 *
 * BullMQ already publishes every transition on a Redis stream, so this subscribes
 * once per process and fans the events out in memory. Redis is the broadcast point,
 * which means it works unchanged behind a load balancer: an event raised by whichever
 * instance is running the worker reaches the consoles connected to every other one.
 *
 * **Only job state belongs here.** The aggregate reads — metrics, usage, queue counts
 * — have no event to subscribe to; they are snapshots of a rollup, and pushing them
 * on a timer would be polling with a socket in front of it. Those keep their intervals.
 */

/** What a subscriber receives. The job's `result` is stripped — see `dispatch`. */
export type JobEvent = Omit<JobRecord, "result">;

type Listener = (event: JobEvent) => void;

/** tenantId → its connected listeners. Empty sets are deleted, never left behind. */
const listeners = new Map<string, Set<Listener>>();

let queueEvents: QueueEvents | undefined;

/**
 * The stream carries a job id and nothing else, so the tenant that owns the job has
 * to be looked up before the event can be routed — a job must never be announced to
 * another tenant's console. That is one Redis read per transition, skipped entirely
 * when nobody is connected.
 */
const dispatch = async (jobId: string | undefined): Promise<void> => {
  if (!jobId || listeners.size === 0) return;

  try {
    const record = await ocrQueue.getStatus(jobId);
    if (!record?.tenantId) return;

    const subscribers = listeners.get(record.tenantId);
    if (!subscribers?.size) return;

    // `result` is dropped: a completed extraction can be megabytes of text, and a
    // console that needs it fetches the job itself. The event says what changed.
    const { result: _result, ...event } = record;
    for (const listener of subscribers) {
      try {
        listener(event);
      } catch (err) {
        // One broken connection must not stop the others from being notified.
        logger.warn("job.events.listener.failed", { jobId, err: err instanceof Error ? err.message : String(err) });
      }
    }
  } catch (err) {
    logger.warn("job.events.dispatch.failed", { jobId, err: err instanceof Error ? err.message : String(err) });
  }
};

/**
 * Opened on the first subscriber rather than at boot: a worker-only process, or an
 * API instance nobody has a console open against, has no reason to hold the
 * connection. Once open it stays open — reloading a page would otherwise tear the
 * subscription down and rebuild it seconds later.
 */
const ensureSubscribed = (): void => {
  if (queueEvents) return;

  queueEvents = new QueueEvents(OCR_QUEUE_NAME, { connection: createQueueConnection() });

  // `waiting` and `delayed` are what polling missed; the terminal two are what it
  // eventually caught. All four are forwarded so a console sees the whole lifecycle.
  for (const name of ["waiting", "active", "completed", "failed", "delayed"] as const) {
    queueEvents.on(name, ({ jobId }: { jobId?: string }) => void dispatch(jobId));
  }

  queueEvents.on("error", (err) => {
    // Never rethrown: BullMQ reconnects on its own, and an unhandled 'error' on an
    // EventEmitter takes the process down with it.
    logger.warn("job.events.stream.error", { err: err instanceof Error ? err.message : String(err) });
  });

  logger.info("job.events.subscribed", { queue: OCR_QUEUE_NAME });
};

/**
 * Registers `listener` for one tenant's job transitions. Returns the unsubscribe —
 * call it when the connection closes, or the set grows one dead listener per reload.
 */
export const subscribeToJobEvents = (tenantId: string, listener: Listener): (() => void) => {
  ensureSubscribed();

  const subscribers = listeners.get(tenantId) ?? new Set<Listener>();
  subscribers.add(listener);
  listeners.set(tenantId, subscribers);

  return () => {
    const current = listeners.get(tenantId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(tenantId);
  };
};

/** Tears down the subscription. For tests and graceful shutdown. */
export const closeJobEvents = async (): Promise<void> => {
  listeners.clear();
  await queueEvents?.close();
  queueEvents = undefined;
};
