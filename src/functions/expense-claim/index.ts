import { defineOcrFunction, OcrFunction } from "../define";
import { expenseClaimArgsSchema } from "./args";
import { expenseClaimResultSchema } from "./result";
import { executeExpenseClaim } from "./execute";

export const expenseClaim = defineOcrFunction({
  key: OcrFunction.EXPENSE_CLAIM,
  description:
    "Parse an expense claim into claimant, line items, and totals with deterministic reconciliation and a missing-receipt check.",
  accepts: ["pdf", "image", "docx"],
  requires: ["text"],
  sensitivity: "standard",
  maxPages: 10,
  argsSchema: expenseClaimArgsSchema,
  resultSchema: expenseClaimResultSchema,
  execute: executeExpenseClaim,
  confidenceOf: (r) => (r.confidence === "high" ? 1 : 0),
});

export * from "./args";
export * from "./result";
