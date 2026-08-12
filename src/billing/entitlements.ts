import type { OcrFunctionKey, Sensitivity } from "../functions/define";
import type {
  BillingModel,
  EntitlementDecision,
  Feature,
  Money,
  PlanLimits,
  Subscription,
  SubscriptionStatus,
  TrialPolicy,
  TrialWindow,
} from "../types/subscription";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pure entitlement + pricing decisions over a {@link Subscription}.
 *
 * Every function here is side-effect free and takes an explicit `now` where time
 * matters, so the same call is deterministic in tests and identical across the web
 * and worker processes. Nothing here touches Postgres, Redis, or `OcrError` — the
 * middleware layer reads a {@link EntitlementDecision} and maps a denial code to an
 * HTTP status. This mirrors the house rule: functions decide, middleware does I/O.
 */

const ALLOW: EntitlementDecision = { allowed: true };

/** Rank sensitivities so a plan's ceiling can be compared to a function's need. */
const SENSITIVITY_RANK: Record<Sensitivity, number> = { standard: 0, pii: 1, restricted: 2 };

/**
 * The status a subscription *effectively* has at `now`, accounting for elapsed
 * trials and cancel-at-period-end. Stored status can lag (nothing re-writes the row
 * the instant a trial ends); this resolves the truth on read.
 */
export const effectiveStatus = (sub: Subscription, now: Date = new Date()): SubscriptionStatus => {
  if (sub.status === "suspended") return "suspended";

  if (sub.status === "trialing" && sub.trial) {
    const timeUp = sub.trial.endsAt !== null && now >= sub.trial.endsAt;
    const docsUp = sub.trial.documentsRemaining !== null && sub.trial.documentsRemaining <= 0;
    // A trial that requires no payment method expires; one with a method on file would
    // convert to `active` on the billing tick — until then, treat it as still trialing.
    if (timeUp || docsUp) return sub.payment.hasPaymentMethod ? "active" : "expired";
    return "trialing";
  }

  if (sub.cancelAtPeriodEnd && now >= sub.currentPeriodEnd) return "expired";
  return sub.status;
};

/**
 * Resolve a catalog {@link TrialPolicy} into a live {@link TrialWindow} at `now`.
 * Call this when creating a subscription so the trial's dates, document allowance,
 * and per-document size/page ceilings are captured on the record once, rather than
 * re-derived from the plan on every request.
 */
export const resolveTrialWindow = (policy: TrialPolicy, now: Date = new Date()): TrialWindow => ({
  startedAt: now,
  endsAt: policy.durationDays != null ? new Date(now.getTime() + policy.durationDays * DAY_MS) : null,
  documentsRemaining: policy.includedDocuments ?? null,
  maxPagesPerDocument: policy.maxPagesPerDocument ?? null,
  maxFileSizeBytes: policy.maxFileSizeBytes ?? null,
});

/** Pick the more restrictive of two ceilings, where `null` means "no limit". */
const tighter = (a: number | null, b: number | null): number | null => {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
};

/**
 * The size/page/rate/etc. ceilings actually in force right now. Identical to the
 * plan's limits, except **while trialing** the trial's own `maxPagesPerDocument`
 * and `maxFileSizeBytes` are folded in (tighter wins) — so a trial can cap document
 * size and page count below what the paid plan it converts into allows.
 *
 * Read this from the upload/ingest and pipeline middleware to source the effective
 * page and byte caps, instead of reading `plan.entitlements.limits` directly.
 */
export const effectiveLimits = (sub: Subscription, now: Date = new Date()): PlanLimits => {
  const base = sub.plan.entitlements.limits;
  if (effectiveStatus(sub, now) !== "trialing" || !sub.trial) return base;
  return {
    ...base,
    maxPagesPerDocument: tighter(base.maxPagesPerDocument, sub.trial.maxPagesPerDocument),
    maxFileSizeBytes: tighter(base.maxFileSizeBytes, sub.trial.maxFileSizeBytes),
  };
};

/** Whether the subscription may serve requests at all (trialing or active). */
export const isServable = (sub: Subscription, now: Date = new Date()): boolean => {
  const s = effectiveStatus(sub, now);
  // `past_due` is deliberately still served (dunning grace) — availability controls
  // fail toward serving, matching the rate-limiter's fail-open stance.
  return s === "trialing" || s === "active" || s === "past_due";
};

/** Gate the subscription itself before checking any specific function/feature. */
export const requireActive = (sub: Subscription, now: Date = new Date()): EntitlementDecision => {
  if (isServable(sub, now)) return ALLOW;
  return {
    allowed: false,
    code: "SUBSCRIPTION_INACTIVE",
    reason: `Subscription is ${effectiveStatus(sub, now)} — reactivate or add a payment method to continue.`,
  };
};

/** Whether a boolean capability is unlocked (no status check — compose with {@link requireActive}). */
export const hasFeature = (sub: Subscription, feature: Feature): boolean =>
  sub.plan.entitlements.features.includes(feature);

export const requireFeature = (sub: Subscription, feature: Feature): EntitlementDecision =>
  hasFeature(sub, feature)
    ? ALLOW
    : { allowed: false, code: "NOT_ENTITLED", reason: `Your plan does not include '${feature}'.` };

/**
 * Whether a function key is callable under the plan. An empty `allowedFunctions`
 * means "all functions" (backward-compatible with the authorize middleware). Pass
 * the function's `sensitivity` to also enforce the plan's sensitivity ceiling
 * (keeps `pii` functions off standard-tier plans centrally).
 */
export const canUseFunction = (
  sub: Subscription,
  fnKey: OcrFunctionKey,
  opts: { sensitivity?: Sensitivity } = {},
): EntitlementDecision => {
  const { allowedFunctions, maxSensitivity } = sub.plan.entitlements;

  if (allowedFunctions.length > 0 && !allowedFunctions.includes(fnKey)) {
    return { allowed: false, code: "NOT_ENTITLED", reason: `Your plan does not include the '${fnKey}' function.` };
  }

  if (opts.sensitivity && SENSITIVITY_RANK[opts.sensitivity] > SENSITIVITY_RANK[maxSensitivity]) {
    return {
      allowed: false,
      code: "SENSITIVITY_BLOCKED",
      reason: `'${fnKey}' handles ${opts.sensitivity} data, above your plan's ${maxSensitivity} ceiling.`,
    };
  }

  return ALLOW;
};

/**
 * Whether the subscription can process one more document *now*, considering the
 * trial allowance first, then the plan's period quota. Monthly plans with an
 * `overageUnitPrice` never hard-stop — they bill the overage (see {@link quoteDocument}).
 */
export const checkDocumentQuota = (sub: Subscription, now: Date = new Date()): EntitlementDecision => {
  // Trial allowance is consumed before any paid quota.
  if (effectiveStatus(sub, now) === "trialing" && sub.trial?.documentsRemaining !== null) {
    const remaining = sub.trial?.documentsRemaining ?? 0;
    if (remaining <= 0) {
      return { allowed: false, code: "QUOTA_EXCEEDED", reason: "Trial document allowance is used up." };
    }
    return ALLOW;
  }

  const { billing } = sub.plan;
  const cap = periodDocumentCap(billing, sub.plan.entitlements.limits.documentsPerPeriod);
  if (cap === null) return ALLOW; // unlimited

  const overageAllowed = billing.kind === "monthly" && billing.overageUnitPrice !== undefined;
  if (sub.usage.documentsProcessed >= cap && !overageAllowed) {
    return {
      allowed: false,
      code: "QUOTA_EXCEEDED",
      reason: `Period document allowance (${cap}) reached. Upgrade or enable overage to continue.`,
    };
  }
  return ALLOW;
};

/** The effective per-period document cap: the tighter of the billing allowance and the plan limit. */
const periodDocumentCap = (billing: BillingModel, limit: number | null): number | null => {
  const billingCap = billing.kind === "monthly" ? billing.includedDocuments : null;
  if (billingCap === null) return limit;
  if (limit === null) return billingCap;
  return Math.min(billingCap, limit);
};

/**
 * Price to charge for one document of `pages` pages under the current model, at
 * `now`. Returns `null` when nothing is charged (trial coverage, or a monthly plan
 * still within its included allowance). Callers persist the returned {@link Money}
 * against the period usage.
 */
export const quoteDocument = (sub: Subscription, pages: number, now: Date = new Date()): Money | null => {
  // Anything covered by an unexpired trial document allowance is free.
  if (effectiveStatus(sub, now) === "trialing" && (sub.trial?.documentsRemaining ?? 0) > 0) {
    return null;
  }

  const { billing } = sub.plan;
  switch (billing.kind) {
    case "trial":
      return null;

    case "per_document": {
      const surcharge = (billing.perPageSurcharge?.amountMinor ?? 0) * Math.max(0, pages);
      const raw = billing.unitPrice.amountMinor + surcharge;
      const amountMinor = Math.max(raw, billing.minimumCharge?.amountMinor ?? 0);
      return { amountMinor, currency: billing.unitPrice.currency };
    }

    case "monthly": {
      const included = billing.includedDocuments;
      const withinAllowance = included === null || sub.usage.documentsProcessed < included;
      if (withinAllowance) return null; // covered by the flat monthly fee
      if (!billing.overageUnitPrice) return null; // hard-stop plans are gated by checkDocumentQuota
      return { ...billing.overageUnitPrice };
    }
  }
};

/**
 * The rate limit (requests/minute) this subscription should be enforced at, or
 * `undefined` to defer to the env/tenant default. Lets the rate-limit middleware
 * source its ceiling from the plan instead of a hand-set `Tenant.rateLimit`.
 */
export const effectiveRateLimitPerMinute = (sub: Subscription): number | undefined =>
  sub.plan.entitlements.limits.rateLimitPerMinute ?? undefined;

/** One-line description of how this subscription bills, for the admin console. */
export const describeBilling = (sub: Subscription): string => {
  const b = sub.plan.billing;
  switch (b.kind) {
    case "trial":
      return "Free trial";
    case "per_document":
      return `Pay-as-you-go: ${formatMoney(b.unitPrice)} / document`;
    case "monthly":
      return `${formatMoney(b.basePrice)} / month, ${b.includedDocuments ?? "unlimited"} documents included`;
  }
};

/** Format minor units as a human string (e.g. `₦1,500.00`). Presentation only. */
export const formatMoney = (m: Money): string => {
  const symbols: Record<Money["currency"], string> = { NGN: "₦", USD: "$", GBP: "£", EUR: "€" };
  const major = (m.amountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbols[m.currency]}${major}`;
};
