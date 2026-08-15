import "dotenv/config";
import http from "http";

import { initTracing, shutdownTracing } from "./observability/otel";
import { closeDb, ensureSchema, whenDbReady } from "./db";
import { closeRedis, whenRedisReady } from "./redis";
import { ensureBootstrapAdmin } from "./auth/admins";
import { seedPlans } from "./billing/plan-store";
import { logger } from "./observability/logger";
import { env } from "./config/env";
import { main } from "./main";

initTracing();

const app = main();
const server = http.createServer(app);

// Loud warning if the metrics endpoint is left open in production — it exposes
// operational telemetry to anyone who can reach the port.
if (env.NODE_ENV === "production" && !env.METRICS_AUTH_TOKEN) {
  logger.warn("/metrics is unauthenticated (METRICS_AUTH_TOKEN unset) — restrict this port to a private network");
}

/**
 * Boot sequence. We wait for the backing stores to be reachable **before** the
 * server accepts traffic — otherwise the very first request (e.g. an admin login,
 * or resolving a session while loading data) races an unconnected Redis/Postgres
 * client and gets a spurious 503 "store unavailable", which then "fixes itself" on
 * the next attempt once the sockets are up. Waiting here removes that cold-start
 * race entirely.
 *
 * Schema creation is a **hard** prerequisite — without those tables every auth
 * lookup and every OCR request fails — so a failure here aborts the boot and exits
 * non-zero. Seeding the first console owner and the default plan catalog is
 * best-effort by contrast: the service runs correctly without them (they are just
 * conveniences, retried on the next boot), so a seed failure is logged and skipped.
 *
 * If the stores can't be reached at all, we exit non-zero so the orchestrator
 * restarts us rather than serving a broken instance.
 */
const boot = async (): Promise<void> => {
  await Promise.all([whenRedisReady(), whenDbReady()]);

  // Not wrapped: a schema failure must propagate to the `.catch` below and exit.
  // Swallowing it left the service accepting traffic against missing tables while
  // /readyz reported ok, so nothing rolled the deploy back.
  await ensureSchema();

  try {
    await ensureBootstrapAdmin();
    await seedPlans();
  } catch (err) {
    logger.error("boot seeding failed (continuing; retried next boot)", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
};

boot()
  .then(() => server.listen(Number(env.PORT), () => logger.info(`service listening on http://localhost:${env.PORT}`)))
  .catch((err) => {
    logger.error("boot failed: backing stores unreachable or schema could not be applied", {
      err: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });

/**
 * Graceful shutdown: stop accepting new connections, let in-flight requests
 * finish, then release backing resources (flush traces, close Postgres + Redis). A hard
 * timeout forces exit if draining stalls, so a rolling deploy or rollback can't
 * hang forever. Mirrors the worker entrypoint (`src/worker.ts`). 12-factor IX.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return; // second signal during drain — ignore
  shuttingDown = true;
  logger.info("service shutting down", { signal });

  const forced = setTimeout(() => {
    logger.error("graceful shutdown timed out; forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forced.unref(); // don't keep the process alive just for this timer

  try {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await shutdownTracing();
    await closeDb();
    await closeRedis();
    logger.info("shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error("error during shutdown", { err: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
