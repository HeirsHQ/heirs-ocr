import { z } from "zod";

const budgetLineSchema = z.object({
  category: z.string(),
  description: z.string().nullable(),
  planned: z.number().nullable(),
  actual: z.number().nullable(),
  variance: z.number().nullable(),
});

export const budgetAnalysisResultSchema = z.object({
  title: z.string().nullable(),
  period: z.string().nullable(),
  currency: z.string().nullable(),
  lineItems: z.array(budgetLineSchema),
  totals: z.object({
    planned: z.number().nullable(),
    actual: z.number().nullable(),
    variance: z.number().nullable(),
  }),
  /** Deterministic post-validation verdict: line-item sums reconcile to the totals. */
  confidence: z.enum(["high", "low"]),
  warnings: z.array(z.string()),
});

export type BudgetAnalysisResult = z.infer<typeof budgetAnalysisResultSchema>;
