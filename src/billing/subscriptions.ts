import { randomUUID } from "crypto";

import type { Subscription, SubscriptionPlan, SubscriptionStatus, TrialWindow } from "../types/subscription";
import { effectiveStatus, quoteDocument, resolveTrialWindow } from "./entitlements";
import { logger } from "../observability/logger";
import { env } from "../config/env";
import { query } from "../db";

/**
 * Per-tenant subscription store, backed by the `subscriptions` table (src/db.ts).
 *
 * One row per `tenantId`. The full {@link Subscription} — including its snapshotted
 * plan — lives in a `jsonb` `data` column (so a catalog price change never
 * re-prices an existing tenant), with `plan_id`/`status` mirrored out as top-level
 * columns for cheap filtering. Mirrors `src/auth/tenants.ts`: a short-TTL positive+
 * negative cache keeps resolution off the Postgres hot path.
 *
 * Fails **closed**, like the tenant registry. `resolveSubscription` returns
 * `undefined` for exactly one thing — "this tenant has no subscription row" — which
 * the enforcement middleware treats as unlimited (backward-compatible). A store
 * error is *not* that: it propagates, and the middleware answers 503. Collapsing the
 * two would turn a Postgres blip into a fleet-wide billing bypass — every tenant
 * ungated, unmetered, and served at the default rate ceiling.
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

/**
 * The billing store could not be read. Distinct from "no subscription row" so the
 * enforcement middleware can answer 503 instead of silently waiving every limit.
 * Kept free of any HTTP dependency; `require-subscription` maps it to the wire.
 */
export class SubscriptionStoreUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Subscription store unavailable", { cause });
    this.name = "SubscriptionStoreUnavailableError";
  }
}

type CacheEntry = { subscription: Subscription | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const cacheTtlMs = () => env.API_KEY_CACHE_TTL_SECONDS * 1000;
const negativeTtlMs = () => Math.min(cacheTtlMs(), 5_000);

/**
 * Resolves a tenant's subscription, or `undefined` if the tenant has **no
 * subscription row**. Short-TTL caching, including negative caching, keeps a tenant
 * with no subscription from hitting Postgres on every request.
 *
 * Throws {@link SubscriptionStoreUnavailableError} if the store cannot be read —
 * callers must not conflate that with `undefined`. See the module note above.
 */
export const resolveSubscription = async (tenantId: string): Promise<Subscription | undefined> => {
  const hit = cache.get(tenantId);
  if (hit && hit.expiresAt > Date.now()) return hit.subscription ?? undefined;

  let rows: SubscriptionRow[];
  try {
    ({ rows } = await query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE tenant_id = $1`, [tenantId]));
  } catch (err) {
    logger.error("subscription store unavailable", {
      tenantId,
      err: err instanceof Error ? err.message : String(err),
    });
    throw new SubscriptionStoreUnavailableError(err);
  }

  const row = rows[0];
  if (!row) {
    cache.set(tenantId, { subscription: null, expiresAt: Date.now() + negativeTtlMs() });
    return undefined;
  }
  const subscription = reviveSubscription(row.data as Record<string, unknown>);
  cache.set(tenantId, { subscription, expiresAt: Date.now() + cacheTtlMs() });
  return subscription;
};

/**
 * Every tenant's subscription, most recently updated first. Admin-console read only
 * — uncached and unbounded, so keep it off the request hot path.
 */
export const listSubscriptions = async (): Promise<Subscription[]> => {
  try {
    const { rows } = await query<SubscriptionRow>(`SELECT * FROM subscriptions ORDER BY updated_at DESC`);
    return rows.map((row) => reviveSubscription(row.data as Record<string, unknown>));
  } catch (err) {
    logger.error("subscription store unavailable", {
      op: "listSubscriptions",
      err: err instanceof Error ? err.message : String(err),
    });
    throw new SubscriptionStoreUnavailableError(err);
  }
};

/**
 * Estate-wide subscription totals, for the console's stat tiles.
 *
 * Exists so the subscriptions page can page its table normally. Previously the page
 * pulled the entire catalog at `MAX_PAGE_SIZE` and cut it in the browser, because
 * the tiles describe the whole estate — paging the query would have made them
 * silently describe page 1 instead. Splitting the aggregate out means the list is a
 * page and the tiles are a total, each fetched as what it is.
 *
 * Aggregated in Node rather than SQL on purpose: `subscriptions` holds one row per
 * tenant, so it is bounded by customer count rather than growing with time, and the
 * accrued figure lives inside the `data` jsonb behind a billing union that would
 * take some unpleasant path expressions to sum. The win being banked here is that
 * the *browser* no longer downloads the catalog — not that the database does less
 * work. If tenant count ever makes this read hurt, the counts move to SQL first.
 */
export type SubscriptionSummary = {
  total: number;
  /** Enrolments currently serving traffic. */
  serving: number;
  /** Enrolments an operator should look at (past due or suspended). */
  attention: number;
  /** Per-status breakdown, for anything that wants more than the two buckets above. */
  byStatus: Record<string, number>;
  /**
   * Accrued this period, grouped by currency and sorted descending.
   *
   * Grouped rather than summed into one figure because plans may price in different
   * currencies, and adding those together would produce a number that means nothing.
   */
  accruedByCurrency: { currency: string; amountMinor: number }[];
};

/**
 * A subscription as a *reader* should see it.
 *
 * `status` is the value on the record; `effectiveStatus` is what the system actually
 * enforces right now. They diverge whenever time has passed without a billing tick:
 * a trial whose window elapsed is still stored as `trialing`, but
 * {@link effectiveStatus} reports `expired` (or `active` where a payment method is on
 * file), and it is that derived value the entitlement checks use to allow or deny a
 * request.
 *
 * Reporting the stored value in the console therefore showed enrolments as "serving"
 * that the API was already refusing — the dashboard and the enforcement disagreeing
 * about the same subscription. Read endpoints return both: the derived one is the
 * truth to display, the stored one stays visible so the drift is auditable rather
 * than silently overwritten.
 */
export type EffectiveSubscription = Subscription & { effectiveStatus: SubscriptionStatus };

/** Attaches the derived status. Pure — it never writes the record back. */
export const toEffectiveSubscription = (sub: Subscription, now: Date = new Date()): EffectiveSubscription => ({
  ...sub,
  effectiveStatus: effectiveStatus(sub, now),
});

/** A plan's currency, whichever arm of the billing union it uses. */
const currencyOf = (sub: Subscription): string => {
  const billing = sub.plan.billing;
  if (billing.kind === "per_document") return billing.unitPrice.currency;
  if (billing.kind === "monthly") return billing.basePrice.currency;
  // A free plan accrues nothing; the code is only a grouping key.
  return "NGN";
};

export const getSubscriptionSummary = async (): Promise<SubscriptionSummary> => {
  const subs = await listSubscriptions();

  const now = new Date();
  const byStatus: Record<string, number> = {};
  const accrued = new Map<string, number>();
  for (const sub of subs) {
    // The *derived* status — see `toEffectiveSubscription`. Counting the stored one
    // reported lapsed trials as "serving" while the API was already refusing them.
    const status = effectiveStatus(sub, now);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const currency = currencyOf(sub);
    accrued.set(currency, (accrued.get(currency) ?? 0) + sub.usage.amountAccruedMinor);
  }

  return {
    total: subs.length,
    serving: (byStatus.active ?? 0) + (byStatus.trialing ?? 0),
    attention: (byStatus.past_due ?? 0) + (byStatus.suspended ?? 0),
    byStatus,
    accruedByCurrency: [...accrued.entries()]
      .map(([currency, amountMinor]) => ({ currency, amountMinor }))
      .sort((a, b) => b.amountMinor - a.amountMinor),
  };
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
