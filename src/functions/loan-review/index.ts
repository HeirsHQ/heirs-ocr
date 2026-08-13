import { defineOcrFunction, OcrFunction } from "../define";
import { loanReviewArgsSchema } from "./args";
import { loanReviewResultSchema } from "./result";
import { executeLoanReview } from "./execute";

export const loanReview = defineOcrFunction({
  key: OcrFunction.LOAN_REVIEW,
  description:
    "Review a loan application pack: extract borrower financials, then compute affordability and a recommendation deterministically.",
  accepts: ["pdf", "image"],
  requires: ["text"],
  // Handles personal financial data → PII policy (no-store, redacted logs).
  sensitivity: "pii",
  maxPages: 30,
  argsSchema: loanReviewArgsSchema,
  resultSchema: loanReviewResultSchema,
  execute: executeLoanReview,
  confidenceOf: (r) => (r.confidence === "high" ? 1 : 0),
});

export * from "./args";
export * from "./result";
