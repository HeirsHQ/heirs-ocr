import "dotenv/config";
import http from "http";

import { initTracing, shutdownTracing } from "./observability/otel";
import { closeDb, ensureSchema } from "./db";
import { closeRedis } from "./redis";
import { startBackgroundWorkers, waitForStores } from "./boot";
import { verify as verifyMailer } from "./notification/mail";
import { seedPlans } from "./billing/plan-store";
import { logger } from "./observability/logger";
import { env } from "./config/env";

/**
 * Dedicated worker entrypoint. Runs the BullMQ loop in its own process so async
 * jobs are drained independently of the HTTP server. Deploy alongside the API
 * (`node build/worker.js`).
 */
initTracing();

let stopBackgroundWorkers: (() => Promise<void>) | undefined;

/**
 * Liveness endpoint. The image's HEALTHCHECK probes `GET /healthz` on `PORT` for
 * every process type, so the worker answers it too — same contract as the API's
 * `/healthz` (process is up, no store checks). Only listens once boot has finished,
 * so a worker still waiting on the stores reads unhealthy, like the API.
 */
const healthServer = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(404).end();
});

// Not fatal: the probe is a container concern. Run locally beside the API, PORT is
// already taken — keep draining jobs rather than exit over the health port.
healthServer.on("error", (err) => {
  logger.warn("worker health endpoint unavailable", { port: env.PORT, err: err.message });
});

/**
 * Wait for Redis + Postgres to be reachable before starting the BullMQ loop, then
 * ensure the schema (idempotent — either process may win on a fresh deploy) and
 * seed the plan catalog. Processed jobs hit Postgres (usage, tenant resolution) and
 * the shared Redis client, so starting the loop before the stores are up would let
 * an early job race an unconnected client. Exit non-zero if the stores are
 * unreachable so the orchestrator restarts us.
 */
const boot = async (): Promise<void> => {
  // Same retry as the web entrypoint — see src/boot.ts.
  await waitForStores();

  // Hard prerequisite — a worker without the schema drains the queue by failing
  // every job. Let it propagate and exit rather than start and destroy work.
  await ensureSchema();

  try {
    await seedPlans();
  } catch (err) {
    logger.error("worker plan seeding failed (continuing; retried next boot)", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  // Same rationale as the web entrypoint: the worker sends job-complete and
  // job-failure mail, so it needs the relay checked here too. Not awaited.
  void verifyMailer();

  stopBackgroundWorkers = startBackgroundWorkers();
  healthServer.listen(Number(env.PORT), () => logger.info("worker health endpoint listening", { port: env.PORT }));
  logger.info("ocr worker started");
};

boot().catch((err) => {
  logger.error("worker boot failed: backing stores unreachable or schema could not be applied", {
    err: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info("ocr worker shutting down", { signal });
  healthServer.close();
  await stopBackgroundWorkers?.();
  await shutdownTracing();
  await closeDb();
  await closeRedis();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
