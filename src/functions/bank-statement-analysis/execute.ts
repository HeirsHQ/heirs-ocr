import type { BankStatementAnalysisResult } from "./result";
import { buildBankStatementAnalysisPrompt } from "./prompt";
import { bankStatementExtractionSchema } from "./result";
import type { BankStatementAnalysisArgs } from "./args";
import type { OcrContext } from "../define";

const EPSILON = 0.02;
const approxEqual = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(EPSILON, EPSILON * Math.abs(b));

/**
 * Parses a bank statement, then computes the credit/debit summary and a
 * reconciliation verdict deterministically from the extracted transactions — never
 * trusting the model's own totals (same split as RECEIPT_PARSING / LOAN_REVIEW).
 *
 * `pii`: the pipeline applies no-store + redacted logging from `sensitivity: "pii"`.
 */
export const executeBankStatementAnalysis = async (
  ctx: OcrContext,
  args: BankStatementAnalysisArgs,
): Promise<BankStatementAnalysisResult> => {
  const { system, user } = buildBankStatementAnalysisPrompt(ctx.doc.markdown, args);

  const { data } = await ctx.llm.complete({
    system,
    user,
    schema: bankStatementExtractionSchema,
    schemaName: "BANK_STATEMENT_ANALYSIS_extraction",
  });

  const totalCredits = data.transactions.reduce((acc, t) => acc + (t.credit ?? 0), 0);
  const totalDebits = data.transactions.reduce((acc, t) => acc + (t.debit ?? 0), 0);
  const warnings: string[] = [];
  let confidence: BankStatementAnalysisResult["confidence"] = "high";

  // Reconcile: opening + credits − debits should land on the closing balance.
  if (data.openingBalance != null && data.closingBalance != null) {
    const derived = data.openingBalance + totalCredits - totalDebits;
    if (!approxEqual(derived, data.closingBalance)) {
      confidence = "low";
      warnings.push(
        `Opening + credits − debits = ${derived.toFixed(2)} but closing balance is ${data.closingBalance.toFixed(2)}.`,
      );
    }
  } else {
    confidence = "low";
    warnings.push("Opening or closing balance missing — could not reconcile the statement.");
  }

  return {
    ...data,
    summary: {
      totalCredits,
      totalDebits,
      netFlow: totalCredits - totalDebits,
      transactionCount: data.transactions.length,
    },
    confidence,
    warnings,
  };
};
