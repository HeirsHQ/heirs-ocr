/**
 * Deterministic payslip arithmetic check, mirroring receipt totals
 * reconciliation (`receipt-parsing/validate.ts`): never trust the model's own
 * sums. On mismatch, downgrade `confidence` to "low" and record a warning so
 * callers can route to human review rather than failing the request.
 *
 * `EPSILON` is a relative tolerance (with a small absolute floor) so it holds
 * across a ₦90k and a ₦9m payslip alike.
 */
export type Reconciliation = { confidence: "high" | "low"; warnings: string[] };

const EPSILON = 0.02;

const approxEqual = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(EPSILON, EPSILON * Math.abs(b));

/** Coerces an extracted value to a finite number, or null (fields arrive as `number | null`). */
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const reconcilePayslip = (fields: Record<string, unknown>): Reconciliation => {
  const warnings: string[] = [];
  let confidence: Reconciliation["confidence"] = "high";

  const basicSalary = num(fields.basicSalary);
  const allowances = num(fields.allowances);
  const grossPay = num(fields.grossPay);
  const netPay = num(fields.netPay);
  const deductions = num(fields.deductions);
  const tax = num(fields.tax);
  const pension = num(fields.pension);

  // Gross ≈ basic + allowances (only checked when gross and at least one component are present).
  if (grossPay != null && (basicSalary != null || allowances != null)) {
    const composed = (basicSalary ?? 0) + (allowances ?? 0);
    if (!approxEqual(composed, grossPay)) {
      confidence = "low";
      warnings.push(`Basic + allowances = ${composed.toFixed(2)} but gross pay is ${grossPay.toFixed(2)}.`);
    }
  }

  // Net ≈ gross − deductions − tax − pension. Payslips vary on whether `deductions`
  // is a grand total (already including tax/pension) or a separate line, so accept
  // either interpretation and only warn when neither reconciles.
  if (netPay != null && grossPay != null) {
    const itemised = grossPay - (deductions ?? 0) - (tax ?? 0) - (pension ?? 0);
    const deductionsAsTotal = grossPay - (deductions ?? 0);
    if (!approxEqual(itemised, netPay) && !approxEqual(deductionsAsTotal, netPay)) {
      confidence = "low";
      warnings.push(`Gross − deductions − tax − pension = ${itemised.toFixed(2)} but net pay is ${netPay.toFixed(2)}.`);
    }
  }

  return { confidence, warnings };
};
