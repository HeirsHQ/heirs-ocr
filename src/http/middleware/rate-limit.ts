import type { NextFunction, Request, Response } from "express";

import { logger } from "../../observability/logger";
import { env } from "../../config/env";
import { getRedis } from "../../redis";
import { OcrError } from "../errors";

/**
 * Per-tenant rate limiting (fixes the DoS surface noted in
 * docs/regression-and-security.md V4). Fixed-window counter in Redis, keyed on
 * `tenantId` (falling back to client IP until real auth lands). Exhaustion
 * returns a `RATE_LIMITED` (429) error with `retryable: true`.
 *
 * **Degraded, not open:** if Redis is unreachable the limiter must not become the
 * outage it exists to prevent, but it must not disappear either. It falls back to a
 * per-process in-memory counter — under N replicas the effective ceiling is N×max,
 * far better than the unbounded flood a pure fail-open would allow.
 */
export const rateLimit = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  if (env.RATE_LIMIT_ENABLED !== "true") {
    next();
    return;
  }

  const id = req.tenantId || req.ip || "anon";
  const max = req.tenant?.rateLimit ?? env.RATE_LIMIT_MAX;
  let allowed: boolean;
  try {
    allowed = await underLimit(id, max);
  } catch (err) {
    logger.warn("rate limiter degraded to in-memory fallback", {
      err: err instanceof Error ? err.message : String(err),
    });
    allowed = underLimitLocal(id, max);
  }
  if (!allowed) {
    next(
      new OcrError("RATE_LIMITED", `Rate limit of ${max} requests per ${env.RATE_LIMIT_WINDOW_SECONDS}s exceeded`, {
        retryable: true,
      }),
    );
    return;
  }
  next();
};

/**
 * In-memory fixed-window fallback used only when Redis is unreachable. Per-process
 * and best-effort: the bucket map is swept lazily so a Redis outage can't grow it
 * without bound.
 */
const localBuckets = new Map<string, { count: number; expiresAt: number }>();

const underLimitLocal = (id: string, max: number): boolean => {
  const window = env.RATE_LIMIT_WINDOW_SECONDS;
  const now = Date.now();
  const bucket = Math.floor(now / 1000 / window);
  const key = `${id}:${bucket}`;

  // Drop expired entries so the map tracks only the live window.
  for (const [k, v] of localBuckets) {
    if (v.expiresAt <= now) localBuckets.delete(k);
  }

  const entry = localBuckets.get(key) ?? { count: 0, expiresAt: (bucket + 1) * window * 1000 };
  entry.count += 1;
  localBuckets.set(key, entry);
  return entry.count <= max;
};

/** Fixed-window counter: INCR the window bucket, set its TTL on the first hit. */
const underLimit = async (id: string, max: number): Promise<boolean> => {
  const window = env.RATE_LIMIT_WINDOW_SECONDS;
  const bucket = Math.floor(Date.now() / 1000 / window);
  const key = `ratelimit:${id}:${bucket}`;

  const redis = getRedis();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, window);
  }
  return count <= max;
};
