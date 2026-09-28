import { defineOcrFunction, OcrFunction } from "../define";
import { assessBudgetAnalysis } from "./confidence";
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
  confidenceOf: assessBudgetAnalysis,
});

export * from "./args";
export * from "./result";
