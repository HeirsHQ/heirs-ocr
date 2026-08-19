import { startWebhookDelivery } from "./webhooks/deliver";
import { startRetentionSweeper } from "./jobs/retention";
import { logger } from "./observability/logger";
import { startWorker } from "./jobs/worker";
import { whenRedisReady } from "./redis";
import { whenDbReady } from "./db";

/**
 * Waits for the backing stores, retrying a transient failure before giving up.
 *
 * Both entrypoints used to await a single readiness window each and treat one
 * failure as fatal. That is too brittle for the most common way this actually fails:
 * a DNS hiccup resolving a managed host returns `EAI_AGAIN` — the error whose name
 * literally means "try again" — and the process would exit permanently over a
 * condition that clears in seconds. Under an orchestrator the restart papered over
 * it; run locally there is nothing to restart the process, so the backend simply
 * stayed down.
 *
 * Retrying does **not** weaken the guarantee the original code was protecting: the
 * server still refuses to accept traffic until both stores answer, and a genuinely
 * unreachable store still ends in a non-zero exit for the orchestrator to act on. It
 * only stops one unlucky lookup from being terminal.
 */

/** Attempts before the boot is declared failed. */
const ATTEMPTS = 3;
/** Pause between attempts. Short — a transient DNS or TLS failure clears fast. */
const RETRY_DELAY_MS = 5_000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForStores = async (attempts = ATTEMPTS): Promise<void> => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // Both are hard dependencies, so they are waited on together; whichever fails
      // first rejects, and the next attempt re-checks both.
      await Promise.all([whenRedisReady(), whenDbReady()]);
      if (attempt > 1) logger.info("backing stores reachable", { attempt });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === attempts) {
        logger.error("backing stores unreachable after retries", { attempts, err: message });
        throw err;
      }
      logger.warn("backing stores not ready; retrying", { attempt, of: attempts, err: message });
      await delay(RETRY_DELAY_MS);
    }
  }
};

/**
 * Starts the background work this service needs running *somewhere*: the BullMQ OCR
 * worker, the retention sweep, and webhook delivery. Returns a function that stops
 * all three.
 *
 * Shared by both entrypoints so the set cannot drift — the dedicated worker process
 * always runs them, and the web process does too unless `RUN_BACKGROUND_WORKERS` is
 * turned off because a separate worker is deployed. See that setting for why the
 * default is on and why running them twice is safe.
 */
export const startBackgroundWorkers = (): (() => Promise<void>) => {
  const worker = startWorker();
  const stopSweeper = startRetentionSweeper();
  const stopWebhooks = startWebhookDelivery();
  logger.info("background workers started");

  return async () => {
    stopSweeper();
    stopWebhooks();
    await worker.close();
  };
};
