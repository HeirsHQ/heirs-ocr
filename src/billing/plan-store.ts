import { logger } from "../observability/logger";
import { env } from "../config/env";
import { query } from "../db";
import type { PlanTier, SubscriptionPlan } from "../types/subscription";
import { DEFAULT_PLANS } from "./plans";

/**
 * Durable, admin-managed plan catalog, backed by the `plans` table (src/db.ts).
 *
 * One row per plan id. The full {@link SubscriptionPlan} lives in a `jsonb` `data`
 * column, with `tier`/`hidden` mirrored out for cheap filtering. At boot,
 * {@link seedPlans} populates the table from the code {@link DEFAULT_PLANS} if it is
 * empty; thereafter the DB is the source of truth and the admin API edits it.
 *
 * A short-TTL cache keeps the list read (used by the admin console and, later,
 * self-serve) off the Postgres hot path. Unlike `resolveSubscription`, reads here do
 * **not** fail open — plan management is an admin-path concern, so a store error
 * propagates and the route wrapper turns it into a 500 rather than silently serving
 * an empty catalog.
 */

type PlanRow = {
  id: string;
  tier: string;
  hidden: boolean;
  data: unknown; // jsonb — node-pg parses it to a JS object
  updated_at: Date;
};

/** A plan carries no Date fields, so `data` rehydrates directly with no revival. */
const revivePlan = (data: unknown): SubscriptionPlan => data as SubscriptionPlan;

/** Self-serve display order, cheapest tier first (matches `publicPlans`). */
const TIER_ORDER: PlanTier[] = ["trial", "payg", "starter", "business", "enterprise"];
const byTierThenId = (a: SubscriptionPlan, b: SubscriptionPlan): number =>
  TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.id.localeCompare(b.id);

const cacheTtlMs = () => env.API_KEY_CACHE_TTL_SECONDS * 1000;
let listCache: { plans: SubscriptionPlan[]; expiresAt: number } | undefined;
const invalidate = (): void => {
  listCache = undefined;
};

/** All plans, tier-ordered. Cached for a short TTL; a write invalidates the cache. */
export const listPlans = async (): Promise<SubscriptionPlan[]> => {
  if (listCache && listCache.expiresAt > Date.now()) return listCache.plans;
  const { rows } = await query<PlanRow>(`SELECT * FROM plans`);
  const plans = rows.map((r) => revivePlan(r.data)).sort(byTierThenId);
  listCache = { plans, expiresAt: Date.now() + cacheTtlMs() };
  return plans;
};

/** One plan by id, or `undefined` if it does not exist. */
export const getStoredPlan = async (id: string): Promise<SubscriptionPlan | undefined> => {
  const { rows } = await query<PlanRow>(`SELECT * FROM plans WHERE id = $1`, [id]);
  return rows[0] ? revivePlan(rows[0].data) : undefined;
};

/** Upsert a plan and invalidate the list cache. */
export const putPlan = async (plan: SubscriptionPlan): Promise<void> => {
  await query(
    `INSERT INTO plans (id, tier, hidden, data, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET
       tier = excluded.tier,
       hidden = excluded.hidden,
       data = excluded.data,
       updated_at = now()`,
    [plan.id, plan.tier, plan.hidden ?? false, JSON.stringify(plan)],
  );
  invalidate();
  logger.info("plan.upserted", { planId: plan.id, tier: plan.tier });
};

/** Delete a plan by id; returns the number of rows removed (0 = not found). Existing
 * subscriptions are unaffected — they carry their own plan snapshot. */
export const deletePlan = async (id: string): Promise<number> => {
  const { rowCount } = await query(`DELETE FROM plans WHERE id = $1`, [id]);
  invalidate();
  return rowCount ?? 0;
};

/**
 * Seed the catalog from {@link DEFAULT_PLANS} when the table is empty — the same
 * "seed on boot" ethos as `ensureBootstrapAdmin`. A no-op once any plan exists, so
 * admin edits are never overwritten on the next deploy. Idempotent and race-safe:
 * {@link putPlan} upserts, so if two processes seed concurrently they write identical
 * default data rather than duplicating.
 */
export const seedPlans = async (): Promise<void> => {
  const { rows } = await query<{ n: number }>(`SELECT count(*)::int AS n FROM plans`);
  if ((rows[0]?.n ?? 0) > 0) return;
  const defaults = Object.values(DEFAULT_PLANS);
  for (const plan of defaults) await putPlan(plan);
  logger.info("plans.seeded", { count: defaults.length });
};
