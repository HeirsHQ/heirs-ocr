import "dotenv/config";

import { initTracing, shutdownTracing } from "./observability/otel";
import { logger } from "./observability/logger";
import { startWorker } from "./jobs/worker";

/**
 * Dedicated worker entrypoint. Runs the BullMQ loop in its own process so async
 * jobs are drained independently of the HTTP server. Deploy alongside the API
 * (`node build/worker.js`).
 */
initTracing();

const worker = startWorker();
logger.info("ocr worker started");

const shutdown = async (signal: string): Promise<void> => {
  logger.info("ocr worker shutting down", { signal });
  await worker.close();
  await shutdownTracing();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
