/**
 * Subscription-plan catalog types, mirroring the backend domain model
 * (`src/types/subscription.ts`) and its admin input schema (`src/billing/plan-schema.ts`).
 * The create/update payload is structurally identical to a stored plan, so `Plan`
 * doubles as `PlanInput`. Money is in **minor units** (kobo/cents) on the wire — the
 * form converts to/from major units at the edge.
 */

export type CurrencyCode = "NGN" | "USD" | "GBP" | "EUR";

export interface Money {
  amountMinor: number;
  currency: CurrencyCode;
}

export type PlanTier = "trial" | "payg" | "starter" | "business" | "enterprise";

export type Sensitivity = "standard" | "pii" | "restricted";

export type Feature =
  | "async_jobs"
  | "pii_functions"
  | "batch_upload"
  | "webhooks"
  | "priority_processing"
  | "custom_form_schemas"
  | "extended_retention"
  | "sla_support";

export type BillingModel =
  | { kind: "trial" }
  | { kind: "per_document"; unitPrice: Money; perPageSurcharge?: Money; minimumCharge?: Money }
  | { kind: "monthly"; basePrice: Money; includedDocuments: number | null; overageUnitPrice?: Money };

export type BillingKind = BillingModel["kind"];

export interface PlanLimits {
  documentsPerPeriod: number | null;
  maxPagesPerDocument: number | null;
  maxFileSizeBytes: number | null;
  rateLimitPerMinute: number | null;
  maxConcurrentJobs: number | null;
  dataRetentionDays: number;
}

export interface Entitlements {
  /** Empty = all functions allowed. */
  allowedFunctions: string[];
  maxSensitivity: Sensitivity;
  features: Feature[];
  limits: PlanLimits;
}

export interface TrialPolicy {
  durationDays?: number;
  includedDocuments?: number;
  maxPagesPerDocument?: number;
  maxFileSizeBytes?: number;
  requiresPaymentMethod: boolean;
}

export interface Plan {
  id: string;
  name: string;
  tier: PlanTier;
  description?: string;
  billing: BillingModel;
  entitlements: Entitlements;
  trial?: TrialPolicy;
  hidden?: boolean;
}

/** Create/update payload — same shape as a stored plan. */
export type PlanInput = Plan;

export const PLAN_TIERS: PlanTier[] = ["trial", "payg", "starter", "business", "enterprise"];
export const SENSITIVITIES: Sensitivity[] = ["standard", "pii", "restricted"];
export const CURRENCIES: CurrencyCode[] = ["NGN", "USD", "GBP", "EUR"];
export const BILLING_KINDS: BillingKind[] = ["trial", "per_document", "monthly"];
export const FEATURES: Feature[] = [
  "async_jobs",
  "pii_functions",
  "batch_upload",
  "webhooks",
  "priority_processing",
  "custom_form_schemas",
  "extended_retention",
  "sla_support",
];
