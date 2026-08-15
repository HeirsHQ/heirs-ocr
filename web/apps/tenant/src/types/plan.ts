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

export interface PlanLimits {
  documentsPerPeriod: number | null;
  maxPagesPerDocument: number | null;
  maxFileSizeBytes: number | null;
  rateLimitPerMinute: number | null;
  maxConcurrentJobs: number | null;
  dataRetentionDays: number;
}

export interface Entitlements {
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
