import type { OcrFunctionKey, Sensitivity } from "../functions/define";

/**
 * Billing & entitlement domain model for the Heirs OCR Service.
 *
 * A **plan** is the catalog product (its price, limits, and what it unlocks); a
 * **subscription** is one tenant's live enrolment in a plan (its status, billing
 * period, trial window, and usage). Decisions are never made off raw fields at a
 * call site — the pure guards in `src/billing/entitlements.ts` read this model so
 * the same rules apply in auth, rate-limiting, the pipeline, and the admin console.
 *
 * Ties into the existing tenant registry (`src/auth/tenants.ts`): a subscription
 * is keyed by `tenantId`, and its entitlements are the source of truth for what a
 * tenant's API key may do — `allowedFunctions`, rate limit, and feature access all
 * derive from here rather than being set ad-hoc per key.
 */

/** ISO 4217 currency. The service prices in Naira by default (see the cost SLI). */
export type CurrencyCode = "NGN" | "USD" | "GBP" | "EUR";

/**
 * An amount in the currency's **minor unit** (kobo for NGN, cents for USD), always
 * an integer. Money is never a float — 0.075 tax rates and per-page pricing round
 * badly in IEEE-754, so we store and arithmetic in minor units and format at the edge.
 */
export interface Money {
  /** Integer minor units, e.g. `150000` = ₦1,500.00. */
  amountMinor: number;
  currency: CurrencyCode;
}

/**
 * The three ways a plan bills, as a discriminated union on `kind`. A pure trial is
 * modelled here as its own free `kind` **and** any paid plan may additionally open
 * with a {@link TrialWindow} (trial-then-charge) — the two are independent.
 */
export type BillingModel =
  | {
      /** Free, time-/quota-bounded evaluation. No payment instrument required. */
      kind: "trial";
    }
  | {
      /** Metered: charge per successfully processed document (pay-as-you-go). */
      kind: "per_document";
      /** Price of one processed document. */
      unitPrice: Money;
      /** Optional per-page surcharge added on top of {@link unitPrice} × pages. */
      perPageSurcharge?: Money;
      /** Never charge less than this for a single document (covers tiny uploads). */
      minimumCharge?: Money;
    }
  | {
      /** Recurring flat fee per calendar month with an included document allowance. */
      kind: "monthly";
      /** The recurring charge billed at each period start. */
      basePrice: Money;
      /** Documents included in the base price; `null` = unlimited (fair-use capped by limits). */
      includedDocuments: number | null;
      /** Price per document once the included allowance is exhausted; omit to hard-stop instead of overage. */
      overageUnitPrice?: Money;
    };

/** Narrow the billing kind without matching the whole union. */
export type BillingKind = BillingModel["kind"];

/**
 * Boolean capabilities a plan unlocks, beyond raw function access. Checked with
 * `hasFeature`/`requireFeature` (src/billing/entitlements.ts) when the caller already
 * holds a subscription, or `tenantHasFeature` (src/billing/feature-access.ts) when it
 * has only a tenant id, so a gated path fails with a clear typed error instead of
 * silently doing less.
 *
 * Only `webhooks` is enforced today. The rest describe the plan catalog and are not
 * checked anywhere yet — and PII access is gated by the plan's `maxSensitivity`
 * ceiling in `canUseFunction`, not by `pii_functions`.
 */
export type Feature =
  /** Submit large/multi-page work to the async job queue (`GET /v1/ocr/jobs/:id`). */
  | "async_jobs"
  /** Call `pii`/`restricted` sensitivity functions (e.g. ID_VERIFICATION). */
  | "pii_functions"
  /** Multiple files in one request / bulk submission. */
  | "batch_upload"
  /** Delivery of results to a tenant callback URL. */
  | "webhooks"
  /** Jump the queue ahead of standard-tier work. */
  | "priority_processing"
  /** Caller-defined dynamic schemas for FORM_DATA_EXTRACTION. */
  | "custom_form_schemas"
  /** Longer result/extraction retention than the default. */
  | "extended_retention"
  /** Contractual support / SLA response times. */
  | "sla_support";

/**
 * Hard numeric ceilings. `null` means "no limit imposed by the plan" (the service's
 * global caps in `env` still apply). These override the per-tenant/env defaults —
 * e.g. `rateLimitPerMinute` feeds `Tenant.rateLimit`, `maxFileSizeBytes` narrows
 * `MAX_FILE_SIZE_BYTES` downward for cheaper tiers.
 */
export interface PlanLimits {
  /** Documents allowed in the current billing period; `null` = unlimited. */
  documentsPerPeriod: number | null;
  /** Pages per single document; `null` defers to each function's `maxPages`. */
  maxPagesPerDocument: number | null;
  /** Upload size ceiling in bytes; `null` defers to `MAX_FILE_SIZE_BYTES`. */
  maxFileSizeBytes: number | null;
  /** Requests/minute for this tenant; `null` defers to `RATE_LIMIT_MAX`. */
  rateLimitPerMinute: number | null;
  /** In-flight async jobs allowed at once; `null` = unbounded. */
  maxConcurrentJobs: number | null;
  /** Days results/extractions are retained. */
  dataRetentionDays: number;
}

/**
 * The complete "what can this tenant do" set. `allowedFunctions` mirrors and
 * supersedes `Tenant.allowedFunctions`: an empty array here means **all** functions
 * (backward-compatible with the authorize middleware), a non-empty array restricts.
 */
export interface Entitlements {
  /** Function keys unlocked. Empty = all functions allowed. */
  allowedFunctions: OcrFunctionKey[];
  /** Highest data sensitivity this plan may process; gates `pii`/`restricted` functions. */
  maxSensitivity: Sensitivity;
  /** Boolean capability flags. */
  features: Feature[];
  limits: PlanLimits;
}

/** Ordered tiers, least → most capable. Useful for upgrade/downgrade comparisons. */
export type PlanTier = "trial" | "payg" | "starter" | "business" | "enterprise";

/**
 * A sellable plan. Immutable catalog data — a subscription snapshots the plan it
 * was created under (`Subscription.plan`) so a later catalog price change never
 * silently re-prices an existing tenant.
 */
export interface SubscriptionPlan {
  id: string;
  name: string;
  tier: PlanTier;
  /** Marketing/one-line description for the admin console and self-serve UI. */
  description?: string;
  billing: BillingModel;
  entitlements: Entitlements;
  /** Default trial applied when a tenant starts on this plan; omit for no trial. */
  trial?: TrialPolicy;
  /** Hidden from self-serve signup (e.g. bespoke enterprise deals). */
  hidden?: boolean;
}

/** How a trial is bounded when a plan grants one. Either bound can be omitted. */
export interface TrialPolicy {
  /** Length of the free window in days; omit for a purely quota-bounded trial. */
  durationDays?: number;
  /** Free document allowance for the trial; omit for a purely time-bounded trial. */
  includedDocuments?: number;
  /**
   * Max pages per document allowed **during the trial**. Applied on top of the
   * plan's own `maxPagesPerDocument`; the tighter of the two wins, so a trial can
   * be more restrictive than the paid tier it converts into. Omit to defer to the
   * plan limit.
   */
  maxPagesPerDocument?: number;
  /**
   * Max upload size in bytes allowed **during the trial**, combined the same
   * (tighter-wins) way with the plan's `maxFileSizeBytes`. Omit to defer to the
   * plan limit.
   */
  maxFileSizeBytes?: number;
  /** Whether a payment instrument is required up front to start the trial. */
  requiresPaymentMethod: boolean;
}

/** The live trial window on a subscription (a {@link TrialPolicy} resolved to dates). */
export interface TrialWindow {
  startedAt: Date;
  /** Trial ends at this instant; `null` if bounded purely by document count. */
  endsAt: Date | null;
  /** Free documents remaining under the trial; `null` if bounded purely by time. */
  documentsRemaining: number | null;
  /** Page ceiling per document while trialing; `null` = defer to the plan limit. */
  maxPagesPerDocument: number | null;
  /** Upload-size ceiling (bytes) while trialing; `null` = defer to the plan limit. */
  maxFileSizeBytes: number | null;
  /** Set once the trial has been converted, expired, or canceled. */
  endedAt?: Date;
}

/**
 * Subscription lifecycle:
 *
 *   trialing → active → (past_due ⇄ active) → canceled/expired
 *                    ↘ suspended (operator hold, any state)
 */
export type SubscriptionStatus =
  /** Inside a free trial window. */
  | "trialing"
  /** Paid and current. */
  | "active"
  /** A charge (recurring or overage) failed; in dunning/retry, still served per policy. */
  | "past_due"
  /** Ended by the tenant/operator; runs until `currentPeriodEnd` if `cancelAtPeriodEnd`. */
  | "canceled"
  /** Trial or paid term elapsed with no active plan. */
  | "expired"
  /** Operator hold (abuse, chargeback, manual review) — access blocked regardless of billing. */
  | "suspended";

/** Payment gateway backing the subscription. `manual` = invoiced/offline (no gateway). */
export type PaymentProvider = "paystack" | "flutterwave" | "stripe" | "manual";

/** Reference to the tenant's record at the payment gateway; never holds card data. */
export interface PaymentBinding {
  provider: PaymentProvider;
  /** Gateway customer id (e.g. Paystack customer code). */
  customerRef?: string;
  /** Gateway subscription/plan id, for recurring models. */
  providerSubscriptionRef?: string;
  /** True once a usable payment instrument is on file. */
  hasPaymentMethod: boolean;
}

/**
 * Usage accrued **within the current billing period**, reset at each period roll.
 * Distinct from lifetime `tenant_usage` (src/observability/usage.ts): that is an
 * ever-growing operational counter; this is the metering window billing reads.
 */
export interface PeriodUsage {
  documentsProcessed: number;
  pagesProcessed: number;
  tokensUsed: number;
  /** Money accrued this period (per-document charges + monthly overage), in minor units. */
  amountAccruedMinor: number;
}

/**
 * A tenant's live subscription. Persisted one-per-tenant and rehydrated onto the
 * request (alongside `req.tenant`) so entitlement guards run without a per-call
 * catalog lookup.
 */
export interface Subscription {
  id: string;
  tenantId: string;
  /**
   * Snapshot of the plan at enrolment time. Carried by value so a catalog price or
   * limit change never retroactively alters an existing subscription; a migration
   * or explicit plan-change re-snapshots it.
   */
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  /** Present while (or after) a trial applies; drives `trialing` status and free-doc gating. */
  trial?: TrialWindow;
  /** Billing period window. For `per_document` this is the metering/rollup window. */
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  /** When true, a `canceled` subscription stays served until `currentPeriodEnd`, then expires. */
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;
  usage: PeriodUsage;
  payment: PaymentBinding;
  createdAt: Date;
  updatedAt: Date;
}

/** Why an entitlement check failed, mapped to the HTTP layer by the caller. */
export type EntitlementDenialCode =
  /** No active/trialing subscription — payment or reactivation required. */
  | "SUBSCRIPTION_INACTIVE"
  /** Plan does not include the requested function or feature. */
  | "NOT_ENTITLED"
  /** Period document allowance (or trial allowance) is exhausted. */
  | "QUOTA_EXCEEDED"
  /** Plan's sensitivity ceiling is below the function's sensitivity. */
  | "SENSITIVITY_BLOCKED";

/**
 * Result of a guard: `allowed`, or a denial with a stable code and human reason.
 * Kept free of `OcrError` so the billing layer stays decoupled from the HTTP layer
 * — the middleware maps a code to the right status (402/403/429).
 */
export type EntitlementDecision = { allowed: true } | { allowed: false; code: EntitlementDenialCode; reason: string };
