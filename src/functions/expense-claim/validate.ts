import type { ExpenseClaimResult } from "./result";

/**
 * Deterministic post-validation, not LLM trust: line-item amounts sum ≈ subtotal,
 * and subtotal + tax ≈ total, within a small relative tolerance. On mismatch,
 * downgrade `confidence` to "low" and append warnings rather than failing. A missing
 * receipt on any line also raises a warning (a policy signal for reviewers).
 */
export const EPSILON = 0.02;

const approxEqual = (a: number, b: number, epsilon: number): boolean =>
  Math.abs(a - b) <= Math.max(epsilon, epsilon * Math.abs(b));

export const reconcileExpenseClaim = (result: ExpenseClaimResult, epsilon = EPSILON): ExpenseClaimResult => {
  const warnings = [...result.warnings];
  let confidence: ExpenseClaimResult["confidence"] = "high";

  const withAmount = result.lineItems.filter((li) => li.amount != null);
  if (withAmount.length > 0 && result.subtotal != null) {
    const sum = withAmount.reduce((acc, li) => acc + (li.amount ?? 0), 0);
    if (!approxEqual(sum, result.subtotal, epsilon)) {
      confidence = "low";
      warnings.push(`Line items sum to ${sum.toFixed(2)} but subtotal is ${result.subtotal.toFixed(2)}.`);
    }
  }

  if ((result.subtotal != null || result.tax != null) && result.total != null) {
    const composed = (result.subtotal ?? 0) + (result.tax ?? 0);
    if (!approxEqual(composed, result.total, epsilon)) {
      confidence = "low";
      warnings.push(`Subtotal + tax = ${composed.toFixed(2)} but total is ${result.total.toFixed(2)}.`);
    }
  }

  const missingReceipts = result.lineItems.filter((li) => !li.receiptAttached).length;
  if (missingReceipts > 0) {
    warnings.push(`${missingReceipts} line item(s) have no attached receipt.`);
  }

  return { ...result, confidence, warnings };
};
