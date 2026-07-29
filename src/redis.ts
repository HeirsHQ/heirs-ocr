import Redis from "ioredis";

import { logger } from "./observability/logger";
import { env } from "./config/env";

/**
 * Shared Redis connection (rate limiter now; extraction cache + BullMQ later).
 * A single lazily-created client is reused process-wide.
 *
 * `enableOfflineQueue: false` makes commands **reject immediately** when Redis
 * is unreachable rather than buffering — callers can then fail open fast instead
 * of hanging. The `error` handler prevents an unhandled-error crash; individual
 * call sites decide how to degrade.
 */
let client: Redis | undefined;

export const getRedis = (): Redis => {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      lazyConnect: false,
    });
    client.on("error", (err) => logger.warn("redis error", { err: err.message }));
  }
  return client;
};
