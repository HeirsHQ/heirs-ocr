import { z } from "zod";

export const budgetAnalysisArgsSchema = z.object({
  /** ISO 4217 code. NGN default for the Nigerian market. */
  currency: z.string().length(3).default("NGN"),
});

export type BudgetAnalysisArgs = z.infer<typeof budgetAnalysisArgsSchema>;
