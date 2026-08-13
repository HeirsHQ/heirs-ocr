import { z } from "zod";

import { OcrFunction, type OcrFunctionKey } from "../functions/define";
import type { SubscriptionPlan } from "../types/subscription";

/**
 * Runtime validation for an admin-supplied subscription plan. Mirrors the
 * {@link SubscriptionPlan} domain type (src/types/subscription.ts) so a plan created
 * through the admin API is a fully-formed catalog product — its cost, currency,
 * billing model, and entitlements all come from the request, not from code.
 *
 * The parsed value is structurally a {@link SubscriptionPlan}; the `_assignable`
 * assertion below makes tsc fail if this schema drifts from the domain type.
 * Amounts are in **minor units** (kobo/cents), matching `Money` — callers convert
 * from major units at the edge (the web form) before hitting this API.
 */

/** ISO 4217 codes the money model supports (see `CurrencyCode`). */
const currencySchema = z.enum(["NGN", "USD", "GBP", "EUR"]);

/** An integer money amount in minor units, tagged with its currency. */
const moneySchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: currencySchema,
});

/** The three billing models, discriminated on `kind` (mirrors `BillingModel`). */
const billingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("trial") }),
  z.object({
    kind: z.literal("per_document"),
    unitPrice: moneySchema,
    perPageSurcharge: moneySchema.optional(),
    minimumCharge: moneySchema.optional(),
  }),
  z.object({
    kind: z.literal("monthly"),
    basePrice: moneySchema,
    includedDocuments: z.number().int().nonnegative().nullable(),
    overageUnitPrice: moneySchema.optional(),
  }),
]);

/** Boolean capability flags a plan can unlock (mirrors `Feature`). */
const featureSchema = z.enum([
  "async_jobs",
  "pii_functions",
  "batch_upload",
  "webhooks",
  "priority_processing",
  "custom_form_schemas",
  "extended_retention",
  "sla_support",
]);

/** Every registered OCR function key, so `allowedFunctions` can't name a phantom function. */
const functionKeySchema = z.enum(Object.values(OcrFunction) as [OcrFunctionKey, ...OcrFunctionKey[]]);

/** A non-negative integer ceiling, or `null` for "no plan-imposed limit". */
const nullableLimit = z.number().int().nonnegative().nullable();

/** Hard numeric ceilings (mirrors `PlanLimits`). */
const limitsSchema = z.object({
  documentsPerPeriod: nullableLimit,
  maxPagesPerDocument: nullableLimit,
  maxFileSizeBytes: nullableLimit,
  rateLimitPerMinute: nullableLimit,
  maxConcurrentJobs: nullableLimit,
  dataRetentionDays: z.number().int().nonnegative(),
});

/** What the plan unlocks (mirrors `Entitlements`; empty `allowedFunctions` = all functions). */
const entitlementsSchema = z.object({
  allowedFunctions: z.array(functionKeySchema),
  maxSensitivity: z.enum(["standard", "pii", "restricted"]),
  features: z.array(featureSchema),
  limits: limitsSchema,
});

/** Optional trial applied when a tenant starts on the plan (mirrors `TrialPolicy`). */
const trialPolicySchema = z.object({
  durationDays: z.number().int().positive().optional(),
  includedDocuments: z.number().int().positive().optional(),
  maxPagesPerDocument: z.number().int().positive().optional(),
  maxFileSizeBytes: z.number().int().positive().optional(),
  requiresPaymentMethod: z.boolean(),
});

/** The full create/update payload for a plan. */
export const planInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "id must be a lowercase slug (letters, digits, '_' or '-')"),
  name: z.string().min(1),
  tier: z.enum(["trial", "payg", "starter", "business", "enterprise"]),
  description: z.string().optional(),
  billing: billingSchema,
  entitlements: entitlementsSchema,
  trial: trialPolicySchema.optional(),
  hidden: z.boolean().optional(),
});

export type PlanInput = z.infer<typeof planInputSchema>;

// Compile-time guarantee the schema stays in lockstep with the domain type: if the
// two diverge, this assignment fails to typecheck.
const _assignable: (p: PlanInput) => SubscriptionPlan = (p) => p;
void _assignable;

/**
 * Parses and validates an untrusted plan payload. Returns a discriminated result so
 * the route layer can map failure to a 400 with field detail (mirrors the admin
 * routes' `safeParse` pattern).
 */
export const parsePlanInput = (input: unknown) => planInputSchema.safeParse(input);
