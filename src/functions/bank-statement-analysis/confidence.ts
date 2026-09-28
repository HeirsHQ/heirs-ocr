import { completeness, isPresent, scoreFrom, verdictDeductions, type ConfidenceAssessment } from "../confidence";
import type { BankStatementAnalysisResult } from "./result";

/** Balance-reconciliation verdict and warnings, then key-field fill rate. */
export const assessBankStatementAnalysis = (result: BankStatementAnalysisResult): ConfidenceAssessment =>
  scoreFrom([
    ...verdictDeductions(result.confidence, result.warnings, "The statement's balances could not be reconciled."),
    completeness({
      "account number": isPresent(result.accountNumber),
      transactions: result.transactions.length > 0,
    }),
  ]);
