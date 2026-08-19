import { logger } from "./logger";
import { query } from "../db";

/**
 * Durable usage counters behind the admin console's analytics page. Two rollups,
 * both single-row-per-key upserts — cheap to increment, cheap to read back whole:
 *
 *   tenant_usage(tenant_id, requests, errors, tokens)
 *   function_usage(function_key, requests, errors, tokens, confidence_observations,
 *                  low_confidence, fallbacks)
 *
 * Neither is a Prometheus series. A `tenant` label would make every metric
 * cardinality-unbounded (one per API key); the per-function counters *do* exist in
 * the registry, but that registry is per-process and in-memory, so the console would
 * otherwise show numbers that reset on deploy and omit everything the worker ran.
 * Prometheus keeps the high-resolution operational view; these keep the durable
 * business one, and both are written from the same pipeline call sites.
 */

export type TenantUsage = {
  tenantId: string;
  requests: number;
  errors: number;
  tokens: number;
};

/**
 * Records one request against a tenant. **Fire-and-forget**: usage accounting must
 * never fail or slow a request, so this swallows database errors and is not awaited
 * by the pipeline. A pipeline-run for an unauthenticated dev request (tenantId
 * `anonymous`) is still counted under that id.
 */
export const recordTenantUsage = (
  tenantId: string,
  data: { outcome: "success" | "error"; tokensUsed?: number },
): void => {
  const errorsDelta = data.outcome === "error" ? 1 : 0;
  const tokensDelta = data.tokensUsed ?? 0;

  // Guard the synchronous path too: a missing/mocked db layer would otherwise throw
  // before we ever reach the promise `.catch`.
  try {
    query(
      `INSERT INTO tenant_usage (tenant_id, requests, errors, tokens)
       VALUES ($1, 1, $2, $3)
       ON CONFLICT (tenant_id) DO UPDATE SET
         requests = tenant_usage.requests + 1,
         errors = tenant_usage.errors + $2,
         tokens = tenant_usage.tokens + $3`,
      [tenantId, errorsDelta, tokensDelta],
    ).catch((err) => {
      logger.warn("usage record failed", { tenantId, err: err instanceof Error ? err.message : String(err) });
    });
  } catch (err) {
    logger.warn("usage record failed", { tenantId, err: err instanceof Error ? err.message : String(err) });
  }
};

/** The `tenant_usage` row shape; bigint columns come back as strings from pg. */
type UsageRow = { tenant_id: string; requests: string; errors: string; tokens: string };

/** All tenants that have any recorded usage, most-requests first. */
export const getAllTenantUsage = async (): Promise<TenantUsage[]> => {
  const { rows } = await query<UsageRow>(`SELECT tenant_id, requests, errors, tokens FROM tenant_usage`);
  return rows
    .map((r) => ({
      tenantId: r.tenant_id,
      requests: Number(r.requests),
      errors: Number(r.errors),
      tokens: Number(r.tokens),
    }))
    .sort((a, b) => b.requests - a.requests);
};

/** One tenant's lifetime operational counters. Missing row = no activity yet. */
export const getTenantUsage = async (tenantId: string): Promise<TenantUsage> => {
  const { rows } = await query<UsageRow>(
    `SELECT tenant_id, requests, errors, tokens FROM tenant_usage WHERE tenant_id = $1`,
    [tenantId],
  );
  const row = rows[0];
  return row
    ? {
        tenantId: row.tenant_id,
        requests: Number(row.requests),
        errors: Number(row.errors),
        tokens: Number(row.tokens),
      }
    : { tenantId, requests: 0, errors: 0, tokens: 0 };
};

/** Lifetime per-function counters; the shape the console's "By function" table reads. */
export type FunctionUsage = {
  function: string;
  requests: number;
  errors: number;
  tokens: number;
  /** Requests whose function exposes a confidence signal — the ratio's denominator. */
  confidenceObservations: number;
  /** Of those, how many landed at or below `LOW_CONFIDENCE_THRESHOLD`. */
  lowConfidence: number;
  /** Requests served by a fallback provider rather than the primary. */
  fallbacks: number;
};

/**
 * Records one request against a function. **Fire-and-forget**, exactly like
 * {@link recordTenantUsage} — analytics must never fail or slow a request.
 *
 * `lowConfidence` is `undefined` for functions that carry no confidence signal, which
 * records no observation at all: counting those as "not low" would silently inflate
 * the denominator and drag every ratio toward zero.
 */
export const recordFunctionUsage = (
  fn: string,
  data: { outcome: "success" | "error"; tokensUsed?: number; lowConfidence?: boolean; fellBack?: boolean },
): void => {
  const errorsDelta = data.outcome === "error" ? 1 : 0;
  const tokensDelta = data.tokensUsed ?? 0;
  const observationDelta = data.lowConfidence === undefined ? 0 : 1;
  const lowDelta = data.lowConfidence ? 1 : 0;
  const fallbackDelta = data.fellBack ? 1 : 0;

  try {
    query(
      `INSERT INTO function_usage
         (function_key, requests, errors, tokens, confidence_observations, low_confidence, fallbacks)
       VALUES ($1, 1, $2, $3, $4, $5, $6)
       ON CONFLICT (function_key) DO UPDATE SET
         requests = function_usage.requests + 1,
         errors = function_usage.errors + $2,
         tokens = function_usage.tokens + $3,
         confidence_observations = function_usage.confidence_observations + $4,
         low_confidence = function_usage.low_confidence + $5,
         fallbacks = function_usage.fallbacks + $6`,
      [fn, errorsDelta, tokensDelta, observationDelta, lowDelta, fallbackDelta],
    ).catch((err) => {
      logger.warn("function usage record failed", { fn, err: err instanceof Error ? err.message : String(err) });
    });
  } catch (err) {
    logger.warn("function usage record failed", { fn, err: err instanceof Error ? err.message : String(err) });
  }
};

/** The `function_usage` row shape; bigint columns come back as strings from pg. */
type FunctionUsageRow = {
  function_key: string;
  requests: string;
  errors: string;
  tokens: string;
  confidence_observations: string;
  low_confidence: string;
  fallbacks: string;
};

/** Every function with recorded activity, busiest first. */
export const getAllFunctionUsage = async (): Promise<FunctionUsage[]> => {
  const { rows } = await query<FunctionUsageRow>(`SELECT * FROM function_usage`);
  return rows
    .map((r) => ({
      function: r.function_key,
      requests: Number(r.requests),
      errors: Number(r.errors),
      tokens: Number(r.tokens),
      confidenceObservations: Number(r.confidence_observations),
      lowConfidence: Number(r.low_confidence),
      fallbacks: Number(r.fallbacks),
    }))
    .sort((a, b) => b.requests - a.requests);
};
