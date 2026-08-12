import type { BudgetAnalysisResult } from "./result";

/**
 * Deterministic post-validation, not LLM trust: the planned (and actual) line items
 * must sum to the reported totals within a small relative tolerance. On mismatch we
 * don't fail — downgrade `confidence` to "low" and append warnings so a caller can
 * route to human review. Mirrors `receipt-parsing/validate.ts`.
 */
export const EPSILON = 0.02;

const approxEqual = (a: number, b: number, epsilon: number): boolean =>
  Math.abs(a - b) <= Math.max(epsilon, epsilon * Math.abs(b));

const sumOf = (values: (number | null)[]): number => values.reduce((acc: number, v) => acc + (v ?? 0), 0);

export const reconcileBudget = (result: BudgetAnalysisResult, epsilon = EPSILON): BudgetAnalysisResult => {
  const warnings = [...result.warnings];
  let confidence: BudgetAnalysisResult["confidence"] = "high";

  const check = (label: string, lineValues: (number | null)[], total: number | null): void => {
    const present = lineValues.filter((v) => v != null);
    if (present.length === 0 || total == null) return;
    const sum = sumOf(present);
    if (!approxEqual(sum, total, epsilon)) {
      confidence = "low";
      warnings.push(`${label} line items sum to ${sum.toFixed(2)} but total ${label} is ${total.toFixed(2)}.`);
    }
  };

  check(
    "planned",
    result.lineItems.map((l) => l.planned),
    result.totals.planned,
  );
  check(
    "actual",
    result.lineItems.map((l) => l.actual),
    result.totals.actual,
  );

  return { ...result, confidence, warnings };
};
