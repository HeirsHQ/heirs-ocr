import { randomUUID } from "crypto";

import { logger } from "../observability/logger";
import { env } from "../config/env";
import { query } from "../db";
import type { Subscription, SubscriptionPlan, TrialWindow } from "../types/subscription";
import { effectiveStatus, quoteDocument, resolveTrialWindow } from "./entitlements";

/**
 * Per-tenant subscription store, backed by the `subscriptions` table (src/db.ts).
 *
 * One row per `tenantId`. The full {@link Subscription} — including its snapshotted
 * plan — lives in a `jsonb` `data` column (so a catalog price change never
 * re-prices an existing tenant), with `plan_id`/`status` mirrored out as top-level
 * columns for cheap filtering. Mirrors `src/auth/tenants.ts`: a short-TTL positive+
 * negative cache keeps resolution off the Postgres hot path.
 *
 * Availability, not security: unlike the tenant registry (which fails closed),
 * `resolveSubscription` returns `undefined` when the store is unreachable — a
 * billing lookup must never take down request serving. `undefined` is treated as
 * "no plan limits" by the enforcement middleware (backward-compatible: tenants
 * without a subscription row are unlimited).
 */

type SubscriptionRow = {
  tenant_id: string;
  plan_id: string;
  status: string;
  data: unknown; // jsonb — node-pg parses it to a JS object
  updated_at: Date;
};

/** jsonb serializes Dates to ISO strings; revive the known Date fields on read. */
const reviveSubscription = (data: Record<string, unknown>): Subscription => {
  const raw = data as unknown as Subscription & Record<string, unknown>;
  const trial: TrialWindow | undefined = raw.trial
    ? {
        ...raw.trial,
        startedAt: new Date(raw.trial.startedAt),
        endsAt: raw.trial.endsAt ? new Date(raw.trial.endsAt) : null,
        endedAt: raw.trial.endedAt ? new Date(raw.trial.endedAt) : undefined,
      }
    : undefined;
  return {
    ...raw,
    trial,
    currentPeriodStart: new Date(raw.currentPeriodStart),
    currentPeriodEnd: new Date(raw.currentPeriodEnd),
    canceledAt: raw.canceledAt ? new Date(raw.canceledAt) : undefined,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  };
};

/** ~1 calendar month from `now`, for the initial billing period window. */
const oneMonthLater = (now: Date): Date => {
  const end = new Date(now);
  end.setMonth(end.getMonth() + 1);
  return end;
};

/**
 * Builds a fresh {@link Subscription} for a tenant enrolling on a plan: snapshots
 * the plan, resolves its trial window (status `trialing` when the plan grants a
 * trial, else `active`), and zeroes the period usage. The caller persists it with
 * {@link putSubscription}. Payment binding starts empty (`manual`, no method) — a
 * real gateway binding is attached separately.
 */
export const createSubscriptionFromPlan = (
  tenantId: string,
  plan: SubscriptionPlan,
  now: Date = new Date(),
): Subscription => {
  const trial = plan.trial ? resolveTrialWindow(plan.trial, now) : undefined;
  return {
    id: `sub_${randomUUID()}`,
    tenantId,
    plan,
    status: trial ? "trialing" : "active",
    trial,
    currentPeriodStart: now,
    currentPeriodEnd: oneMonthLater(now),
    cancelAtPeriodEnd: false,
    usage: { documentsProcessed: 0, pagesProcessed: 0, tokensUsed: 0, amountAccruedMinor: 0 },
    payment: { provider: "manual", hasPaymentMethod: false },
    createdAt: now,
    updatedAt: now,
  };
};

/**
 * Guard for admin subscription assignment: a subscription may only ever be set from a
 * plan that exists in the catalog — no subscription without a real plan behind it.
 * `plan` is the catalog lookup ({@link getStoredPlan} result); `undefined` means the
 * id resolves to nothing, so assignment is refused. Kept pure (the route maps
 * `PLAN_NOT_FOUND` to a 404), so the rule is unit-tested independently of the HTTP layer.
 */
export type PlanAssignment =
  | { ok: true; plan: SubscriptionPlan }
  | { ok: false; code: "PLAN_NOT_FOUND"; reason: string };

export const assignablePlan = (planId: string, plan: SubscriptionPlan | undefined): PlanAssignment =>
  plan ? { ok: true, plan } : { ok: false, code: "PLAN_NOT_FOUND", reason: `No such plan '${planId}'` };

type CacheEntry = { subscription: Subscription | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const cacheTtlMs = () => env.API_KEY_CACHE_TTL_SECONDS * 1000;
const negativeTtlMs = () => Math.min(cacheTtlMs(), 5_000);

/**
 * Resolves a tenant's subscription, or `undefined` if none exists (or the store is
 * briefly unreachable). Short-TTL caching, including negative caching, keeps a
 * tenant with no subscription from hitting Postgres on every request.
 */
export const resolveSubscription = async (tenantId: string): Promise<Subscription | undefined> => {
  const hit = cache.get(tenantId);
  if (hit && hit.expiresAt > Date.now()) return hit.subscription ?? undefined;

  try {
    const { rows } = await query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
    const row = rows[0];
    if (!row) {
      cache.set(tenantId, { subscription: null, expiresAt: Date.now() + negativeTtlMs() });
      return undefined;
    }
    const subscription = reviveSubscription(row.data as Record<string, unknown>);
    cache.set(tenantId, { subscription, expiresAt: Date.now() + cacheTtlMs() });
    return subscription;
  } catch (err) {
    // Fail open for availability: a billing-store blip must not block serving.
    logger.warn("subscription store unavailable", {
      tenantId,
      err: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
};

/** Upserts a subscription and invalidates this process's cache entry. */
export const putSubscription = async (sub: Subscription): Promise<void> => {
  await query(
    `INSERT INTO subscriptions (tenant_id, plan_id, status, data, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, now())
     ON CONFLICT (tenant_id) DO UPDATE SET
       plan_id = excluded.plan_id,
       status = excluded.status,
       data = excluded.data,
       updated_at = now()`,
    [sub.tenantId, sub.plan.id, sub.status, JSON.stringify(sub)],
  );
  cache.delete(sub.tenantId);
  logger.info("subscription.upserted", { tenantId: sub.tenantId, planId: sub.plan.id, status: sub.status });
};

/**
 * Records one processed document against a tenant's subscription: increments period
 * usage, accrues the metered charge ({@link quoteDocument}), and burns down a trial
 * document allowance. **Fire-and-forget** — like `recordTenantUsage`, billing
 * accounting must never fail or slow a request, so errors are swallowed.
 *
 * Read-modify-write, so concurrent documents for one tenant can race and undercount
 * by a few; acceptable for usage metering (exact billing reconciles from the
 * append-only request log, not this counter).
 */
export const recordDocumentUsage = (
  tenantId: string,
  data: { pages: number; tokensUsed?: number; now?: Date },
): void => {
  const now = data.now ?? new Date();
  void (async () => {
    const sub = await resolveSubscription(tenantId);
    if (!sub) return; // no subscription = nothing to meter
    const quote = quoteDocument(sub, data.pages, now);
    const trialing = effectiveStatus(sub, now) === "trialing";

    const next: Subscription = {
      ...sub,
      usage: {
        documentsProcessed: sub.usage.documentsProcessed + 1,
        pagesProcessed: sub.usage.pagesProcessed + Math.max(0, data.pages),
        tokensUsed: sub.usage.tokensUsed + (data.tokensUsed ?? 0),
        amountAccruedMinor: sub.usage.amountAccruedMinor + (quote?.amountMinor ?? 0),
      },
      trial:
        trialing && sub.trial && sub.trial.documentsRemaining !== null
          ? { ...sub.trial, documentsRemaining: Math.max(0, sub.trial.documentsRemaining - 1) }
          : sub.trial,
      updatedAt: now,
    };
    await putSubscription(next);
  })().catch((err) => {
    logger.warn("subscription usage record failed", {
      tenantId,
      err: err instanceof Error ? err.message : String(err),
    });
  });
};
