import { logger } from "./logger";
import { getRedis } from "../redis";

/**
 * Per-tenant usage counters for the admin console's "usage" panel.
 *
 * Deliberately kept out of Prometheus: a `tenant` label would make every metric
 * series cardinality-unbounded (one per API key). Instead these are three plain
 * Redis hashes keyed by tenantId — cheap to increment, cheap to read back whole.
 *
 *   usage:requests  tenantId → total requests
 *   usage:errors    tenantId → requests that ended in error
 *   usage:tokens    tenantId → LLM tokens consumed
 */
const REQUESTS_KEY = "usage:requests";
const ERRORS_KEY = "usage:errors";
const TOKENS_KEY = "usage:tokens";

export type TenantUsage = {
  tenantId: string;
  requests: number;
  errors: number;
  tokens: number;
};

/**
 * Records one request against a tenant. **Fire-and-forget**: usage accounting must
 * never fail or slow a request, so this swallows Redis errors and is not awaited by
 * the pipeline. A pipeline-run for an unauthenticated dev request (tenantId
 * `anonymous`) is still counted under that id.
 */
export const recordTenantUsage = (
  tenantId: string,
  data: { outcome: "success" | "error"; tokensUsed?: number },
): void => {
  // Guard the synchronous path too: a missing/mocked Redis client would otherwise
  // throw before we ever reach the promise `.catch`.
  try {
    const redis = getRedis();
    const ops: Array<Promise<unknown>> = [redis.hincrby(REQUESTS_KEY, tenantId, 1)];
    if (data.outcome === "error") ops.push(redis.hincrby(ERRORS_KEY, tenantId, 1));
    if (data.tokensUsed) ops.push(redis.hincrby(TOKENS_KEY, tenantId, data.tokensUsed));

    Promise.all(ops).catch((err) => {
      logger.warn("usage record failed", { tenantId, err: err instanceof Error ? err.message : String(err) });
    });
  } catch (err) {
    logger.warn("usage record failed", { tenantId, err: err instanceof Error ? err.message : String(err) });
  }
};

/** Reads a numeric hash into a `{ field → number }` map (missing/NaN → skipped). */
const asCounts = (h: Record<string, string>): Map<string, number> => {
  const m = new Map<string, number>();
  for (const [k, v] of Object.entries(h)) {
    const n = Number(v);
    if (Number.isFinite(n)) m.set(k, n);
  }
  return m;
};

/** All tenants that have any recorded usage, merged across the three counters. */
export const getAllTenantUsage = async (): Promise<TenantUsage[]> => {
  const redis = getRedis();
  const [requests, errors, tokens] = await Promise.all([
    redis.hgetall(REQUESTS_KEY),
    redis.hgetall(ERRORS_KEY),
    redis.hgetall(TOKENS_KEY),
  ]);
  const req = asCounts(requests);
  const err = asCounts(errors);
  const tok = asCounts(tokens);

  const tenantIds = new Set<string>([...req.keys(), ...err.keys(), ...tok.keys()]);
  return [...tenantIds]
    .map((tenantId) => ({
      tenantId,
      requests: req.get(tenantId) ?? 0,
      errors: err.get(tenantId) ?? 0,
      tokens: tok.get(tenantId) ?? 0,
    }))
    .sort((a, b) => b.requests - a.requests);
};
