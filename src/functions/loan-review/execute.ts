import { buildLoanReviewPrompt } from "./prompt";
import { loanExtractionSchema } from "./result";
import type { LoanReviewArgs } from "./args";
import type { LoanReviewResult } from "./result";
import type { OcrContext } from "../define";

/**
 * Reviews a loan application pack. The model extracts only the raw figures — never
 * the affordability ratios or the approval decision, which are computed here
 * deterministically. Asking the model to judge affordability is the silent-failure
 * trap this split avoids (same rationale as ID_VERIFICATION's `checks`).
 *
 * Data residency: `pii` — must route through self-hosted vision/Azure, never the
 * China-hosted GLM endpoint. Sensitivity policy (no-store, redacted logs) is applied
 * by the pipeline from `sensitivity: "pii"`.
 */
export const executeLoanReview = async (ctx: OcrContext, args: LoanReviewArgs): Promise<LoanReviewResult> => {
  const { system, user } = buildLoanReviewPrompt(ctx.doc.markdown, args);

  const { data } = await ctx.llm.complete({
    system,
    user,
    schema: loanExtractionSchema,
    schemaName: "LOAN_REVIEW_extraction",
  });

  const monthly = data.income.monthly;
  const debt = data.obligations.monthlyDebt;
  const warnings: string[] = [];

  // Affordability: only computable when monthly income is known.
  const debtToIncome = monthly != null && monthly > 0 ? (debt ?? 0) / monthly : null;
  const disposableIncome = monthly != null ? monthly - (debt ?? 0) : null;

  if (monthly == null) warnings.push("Monthly income not found — affordability could not be computed.");
  if (debt == null) warnings.push("Monthly debt obligations not found — assumed zero for affordability.");
  if (data.requestedAmount == null) warnings.push("Requested loan amount not found.");

  const recommendation = decide(debtToIncome, disposableIncome, args.maxDebtToIncome, monthly);
  // High confidence only when the figures the decision rests on are actually present.
  const confidence: LoanReviewResult["confidence"] = monthly != null && data.requestedAmount != null ? "high" : "low";

  return {
    ...data,
    affordability: { debtToIncome, disposableIncome },
    recommendation,
    confidence,
    warnings,
  };
};

/** Deterministic recommendation from the affordability signals. */
const decide = (
  dti: number | null,
  disposable: number | null,
  maxDti: number,
  monthly: number | null,
): LoanReviewResult["recommendation"] => {
  if (monthly == null || dti == null) return "insufficient-data";
  if (dti <= maxDti && (disposable ?? 0) > 0) return "approve";
  if (dti <= maxDti + 0.2) return "review";
  return "decline";
};
