import { z } from "zod";

export const loanReviewArgsSchema = z.object({
  /** ISO 4217 code. NGN default for the Nigerian market. */
  currency: z.string().length(3).default("NGN"),
  /** Max debt-to-income ratio treated as comfortably affordable (approve threshold). */
  maxDebtToIncome: z.number().min(0).max(1).default(0.4),
});

export type LoanReviewArgs = z.infer<typeof loanReviewArgsSchema>;
