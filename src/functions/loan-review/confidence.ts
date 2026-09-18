import { completeness, isPresent, scoreFrom, verdictDeductions, type ConfidenceAssessment } from "../confidence";
import type { LoanReviewResult } from "./result";

/**
 * The verdict is "low" exactly when a figure the recommendation rests on is missing;
 * each missing figure also raised its own warning.
 */
export const assessLoanReview = (result: LoanReviewResult): ConfidenceAssessment =>
  scoreFrom([
    ...verdictDeductions(
      result.confidence,
      result.warnings,
      "Figures the recommendation rests on are missing from the application.",
    ),
    completeness({ "borrower name": isPresent(result.borrower.name) }),
  ]);
