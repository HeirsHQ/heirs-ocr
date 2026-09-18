import { completeness, scoreFrom, verdictDeductions, type ConfidenceAssessment } from "../confidence";
import type { BudgetAnalysisResult } from "./result";

/** Reconciliation verdict and warnings; a budget with no lines or no totals had nothing to reconcile. */
export const assessBudgetAnalysis = (result: BudgetAnalysisResult): ConfidenceAssessment =>
  scoreFrom([
    ...verdictDeductions(result.confidence, result.warnings, "Budget line items do not reconcile to the totals."),
    completeness({
      "line items": result.lineItems.length > 0,
      totals: result.totals.planned != null || result.totals.actual != null,
    }),
  ]);
