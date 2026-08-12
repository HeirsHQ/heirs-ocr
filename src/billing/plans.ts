import type { CurrencyCode, Money, PlanTier, SubscriptionPlan } from "../types/subscription";
import { OcrFunction } from "../functions/define";

/**
 * The **default/seed** plan catalog. Code-defined starting points so the billing
 * model is usable out of the box; at boot these seed the durable `plans` table
 * (see {@link import("./plan-store").seedPlans}), after which the DB is the source of
 * truth and admins create/edit plans through the admin API. Prices here are
 * placeholders — real ones are set as data, not code. A subscription snapshots the
 * plan it was created under, so editing a plan changes only *new* enrolments.
 *
 * Standard, non-PII functions available on every paying tier.
 */
const STANDARD_FUNCTIONS = [
  OcrFunction.TEXT_EXTRACTION,
  OcrFunction.DOCUMENT_CLASSIFICATION,
  OcrFunction.RECEIPT_PARSING,
  OcrFunction.FORM_DATA_EXTRACTION,
  OcrFunction.RESUME_PARSING,
  OcrFunction.DOCUMENT_AUTHENTICITY,
  OcrFunction.AUTO_EXTRACTION,
  OcrFunction.BUDGET_ANALYSIS,
  OcrFunction.EXPENSE_CLAIM,
];

/** Terse constructor for a Naira amount from whole Naira (avoids kobo arithmetic in the catalog). */
const naira = (amount: number): Money => ({
  amountMinor: Math.round(amount * 100),
  currency: "NGN" satisfies CurrencyCode,
});

export const PLANS: Record<string, SubscriptionPlan> = {
  /** 14-day, 50-document free evaluation. Standard functions only, no PII, no async. */
  free_trial: {
    id: "free_trial",
    name: "Free Trial",
    tier: "trial",
    description: "14 days or 50 documents, whichever comes first.",
    billing: { kind: "trial" },
    trial: {
      durationDays: 14,
      includedDocuments: 50,
      maxPagesPerDocument: 10,
      maxFileSizeBytes: 10 * 1024 * 1024,
      requiresPaymentMethod: false,
    },
    entitlements: {
      allowedFunctions: STANDARD_FUNCTIONS,
      maxSensitivity: "standard",
      features: [],
      limits: {
        documentsPerPeriod: 50,
        maxPagesPerDocument: 10,
        maxFileSizeBytes: 10 * 1024 * 1024,
        rateLimitPerMinute: 10,
        maxConcurrentJobs: null,
        dataRetentionDays: 7,
      },
    },
  },

  /** Metered pay-as-you-go: no commitment, charged per processed document. */
  payg: {
    id: "payg",
    name: "Pay As You Go",
    tier: "payg",
    description: "No monthly fee — pay only for the documents you process.",
    billing: {
      kind: "per_document",
      unitPrice: naira(25),
      perPageSurcharge: naira(5),
      minimumCharge: naira(25),
    },
    entitlements: {
      allowedFunctions: STANDARD_FUNCTIONS,
      maxSensitivity: "standard",
      features: ["custom_form_schemas"],
      limits: {
        documentsPerPeriod: null,
        maxPagesPerDocument: 30,
        maxFileSizeBytes: null,
        rateLimitPerMinute: 30,
        maxConcurrentJobs: 2,
        dataRetentionDays: 30,
      },
    },
  },

  /** Entry monthly tier with an included allowance and metered overage. */
  starter: {
    id: "starter",
    name: "Starter",
    tier: "starter",
    description: "₦25,000/mo — 2,000 documents included, then pay-as-you-go overage.",
    billing: {
      kind: "monthly",
      basePrice: naira(25_000),
      includedDocuments: 2_000,
      overageUnitPrice: naira(15),
    },
    trial: {
      durationDays: 14,
      maxPagesPerDocument: 20,
      maxFileSizeBytes: 15 * 1024 * 1024,
      requiresPaymentMethod: true,
    },
    entitlements: {
      allowedFunctions: STANDARD_FUNCTIONS,
      maxSensitivity: "standard",
      features: ["custom_form_schemas", "async_jobs", "batch_upload"],
      limits: {
        documentsPerPeriod: null,
        maxPagesPerDocument: 50,
        maxFileSizeBytes: null,
        rateLimitPerMinute: 60,
        maxConcurrentJobs: 5,
        dataRetentionDays: 90,
      },
    },
  },

  /** Full-feature monthly tier: PII functions, webhooks, priority queue. */
  business: {
    id: "business",
    name: "Business",
    tier: "business",
    description: "₦120,000/mo — 15,000 documents, PII functions, webhooks, priority processing.",
    billing: {
      kind: "monthly",
      basePrice: naira(120_000),
      includedDocuments: 15_000,
      overageUnitPrice: naira(10),
    },
    trial: {
      durationDays: 14,
      maxPagesPerDocument: 30,
      maxFileSizeBytes: 25 * 1024 * 1024,
      requiresPaymentMethod: true,
    },
    entitlements: {
      allowedFunctions: [
        ...STANDARD_FUNCTIONS,
        OcrFunction.ID_VERIFICATION,
        OcrFunction.SIGNING,
        OcrFunction.LOAN_REVIEW,
        OcrFunction.BANK_STATEMENT_ANALYSIS,
      ],
      maxSensitivity: "pii",
      features: [
        "custom_form_schemas",
        "async_jobs",
        "batch_upload",
        "webhooks",
        "priority_processing",
        "extended_retention",
      ],
      limits: {
        documentsPerPeriod: null,
        maxPagesPerDocument: 100,
        maxFileSizeBytes: null,
        rateLimitPerMinute: 120,
        maxConcurrentJobs: 20,
        dataRetentionDays: 180,
      },
    },
  },

  /** Bespoke, invoiced deals: everything unlocked, limits negotiated. Hidden from self-serve. */
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    tier: "enterprise",
    description: "Custom pricing and limits, invoiced. Contact sales.",
    hidden: true,
    billing: { kind: "monthly", basePrice: naira(0), includedDocuments: null },
    entitlements: {
      allowedFunctions: [], // empty = all functions
      maxSensitivity: "restricted",
      features: [
        "custom_form_schemas",
        "async_jobs",
        "batch_upload",
        "webhooks",
        "priority_processing",
        "extended_retention",
        "sla_support",
      ],
      limits: {
        documentsPerPeriod: null,
        maxPagesPerDocument: null,
        maxFileSizeBytes: null,
        rateLimitPerMinute: null,
        maxConcurrentJobs: null,
        dataRetentionDays: 365,
      },
    },
  },
};

/** Alias making the "seed defaults" role explicit at call sites (e.g. `seedPlans`). */
export const DEFAULT_PLANS = PLANS;

/** Look up a **default** plan by id, or `undefined` if unknown. Runtime lookups go through
 * the DB-backed store (`getStoredPlan`, src/billing/plan-store.ts); this reads code defaults. */
export const getPlan = (id: string): SubscriptionPlan | undefined => PLANS[id];

/** Self-serve-visible plans, cheapest tier first. */
export const publicPlans = (): SubscriptionPlan[] => {
  const order: PlanTier[] = ["trial", "payg", "starter", "business", "enterprise"];
  return Object.values(PLANS)
    .filter((p) => !p.hidden)
    .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
};
