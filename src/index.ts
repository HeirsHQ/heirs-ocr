import "dotenv/config";
import http from "http";

import { initTracing, shutdownTracing } from "./observability/otel";
import { logger } from "./observability/logger";
import { closeRedis } from "./redis";
import { env } from "./config/env";
import { main } from "./main";

initTracing();

const app = main();
const server = http.createServer(app);

server.listen(Number(env.PORT), () => logger.info(`service listening on http://localhost:${env.PORT}`));

/**
 * Graceful shutdown: stop accepting new connections, let in-flight requests
 * finish, then release backing resources (flush traces, close Redis). A hard
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
