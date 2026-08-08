import { defineOcrFunction, OcrFunction } from "../define";
import { receiptParsingArgsSchema } from "./args";
import { receiptParsingResultSchema } from "./result";
import { executeReceiptParsing } from "./execute";

export const receiptParsing = defineOcrFunction({
  key: OcrFunction.RECEIPT_PARSING,
  description: "Parse a receipt into merchant, line items, totals, and payment method with totals reconciliation.",
  accepts: ["pdf", "image"],
  requires: ["text", "tables"],
  sensitivity: "standard",
  maxPages: 5,
  argsSchema: receiptParsingArgsSchema,
  resultSchema: receiptParsingResultSchema,
  execute: executeReceiptParsing,
  // Deterministic totals-reconciliation verdict → a 0/1 confidence for the SLI.
  confidenceOf: (r) => (r.confidence === "high" ? 1 : 0),
});

export * from "./args";
export * from "./result";
