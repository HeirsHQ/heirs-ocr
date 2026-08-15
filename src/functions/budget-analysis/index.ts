import { defineOcrFunction, OcrFunction } from "../define";
import { budgetAnalysisResultSchema } from "./result";
import { budgetAnalysisArgsSchema } from "./args";
import { executeBudgetAnalysis } from "./execute";

export const budgetAnalysis = defineOcrFunction({
  key: OcrFunction.BUDGET_ANALYSIS,
  description:
    "Extract a budget into categorized line items (planned/actual/variance) and totals, with deterministic totals reconciliation.",
  accepts: ["pdf", "image", "docx"],
  // `text` only so it works when the layout/tables provider is disabled; tables
  // improve quality but the parser degrades gracefully to markdown.
  requires: ["text"],
  sensitivity: "standard",
  maxPages: 10,
  argsSchema: budgetAnalysisArgsSchema,
  resultSchema: budgetAnalysisResultSchema,
  execute: executeBudgetAnalysis,
  // Deterministic reconciliation verdict → a 0/1 confidence for the SLI.
  confidenceOf: (r) => (r.confidence === "high" ? 1 : 0),
});

export * from "./args";
export * from "./result";
