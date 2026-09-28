import { completeness, isPresent, scoreFrom, verdictDeductions, type ConfidenceAssessment } from "../confidence";
import type { ExpenseClaimResult } from "./result";

/** Reconciliation verdict and warnings (missing receipts included), then key-field fill rate. */
export const assessExpenseClaim = (result: ExpenseClaimResult): ConfidenceAssessment =>
  scoreFrom([
    ...verdictDeductions(result.confidence, result.warnings, "Expense claim totals do not reconcile."),
    completeness({
      "claimant name": isPresent(result.claimant.name),
      total: result.total != null,
      "line items": result.lineItems.length > 0,
    }),
  ]);
