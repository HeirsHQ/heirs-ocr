import { bankStatementAnalysisResultSchema } from "./result";
import { defineOcrFunction, OcrFunction } from "../define";
import { bankStatementAnalysisArgsSchema } from "./args";
import { executeBankStatementAnalysis } from "./execute";

export const bankStatementAnalysis = defineOcrFunction({
  key: OcrFunction.BANK_STATEMENT_ANALYSIS,
  description:
    "Analyze a bank statement: extract transactions and balances, then compute inflow/outflow totals and reconcile deterministically.",
  accepts: ["pdf", "image"],
  requires: ["text"],
  // Personal financial data → PII policy (no-store, redacted logs).
  sensitivity: "pii",
  maxPages: 30,
  argsSchema: bankStatementAnalysisArgsSchema,
  resultSchema: bankStatementAnalysisResultSchema,
  execute: executeBankStatementAnalysis,
  confidenceOf: (r) => (r.confidence === "high" ? 1 : 0),
});

export * from "./args";
export * from "./result";
