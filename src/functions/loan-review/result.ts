import { z } from "zod";

/** Raw fields the model extracts. The affordability/recommendation are computed. */
export const loanExtractionSchema = z.object({
  borrower: z.object({
    name: z.string().nullable(),
    dateOfBirth: z.string().nullable(),
    /** Bank Verification Number, as printed (may be partially masked). */
    bvn: z.string().nullable(),
    employmentStatus: z.string().nullable(),
    employer: z.string().nullable(),
  }),
  requestedAmount: z.number().nullable(),
  currency: z.string().nullable(),
  tenorMonths: z.number().nullable(),
  income: z.object({ monthly: z.number().nullable() }),
  obligations: z.object({ monthlyDebt: z.number().nullable() }),
  /** Free-text risk observations the model surfaces (e.g. income inconsistency). */
  riskFlags: z.array(z.string()),
  summary: z.string(),
});

export const loanReviewResultSchema = loanExtractionSchema.extend({
  /** Deterministically computed from income + obligations. */
  affordability: z.object({
    debtToIncome: z.number().nullable(),
    disposableIncome: z.number().nullable(),
  }),
  /** Deterministic recommendation from the affordability + data completeness. */
  recommendation: z.enum(["approve", "review", "decline", "insufficient-data"]),
  confidence: z.enum(["high", "low"]),
  warnings: z.array(z.string()),
});

export type LoanReviewResult = z.infer<typeof loanReviewResultSchema>;
