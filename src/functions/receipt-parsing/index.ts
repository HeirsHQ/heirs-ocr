import { defineOcrFunction, OcrFunction } from "../define";
import { buildReceiptResultSchema, verdictKey } from "./fields";
import { receiptParsingArgsSchema } from "./args";
import { executeReceiptParsing } from "./execute";

export const receiptParsing = defineOcrFunction({
  key: OcrFunction.RECEIPT_PARSING,
  description: "Parse a receipt into merchant, line items, totals, and payment method with totals reconciliation.",
  accepts: ["pdf", "image"],
  // `tables` is a preference, not a floor: `execute` reads `doc.markdown` and never
  // touches table blocks, so Tesseract can serve a receipt — just less accurately on
  // the thermal/handwritten ones GLM-OCR handles best. Gating on it made every
  // receipt request unroutable (→ 500) whenever GLM_ENABLED was off, since GLM is
  // the only provider offering `tables` for image/pdf. Mis-read totals still surface:
  // `reconcileTotals` downgrades `confidence` to "low" and appends a warning.
  requires: ["text"],
  prefers: ["tables"],
  sensitivity: "standard",
  maxPages: 5,
  argsSchema: receiptParsingArgsSchema,
  // Dynamic: canonical by default, or the caller's field map (see fields.ts).
  resultSchema: (args) => buildReceiptResultSchema(args.fieldMap),
  execute: executeReceiptParsing,
  // Deterministic totals-reconciliation verdict → a 0/1 confidence for the SLI.
  // Read through `verdictKey` so a caller renaming the field cannot detach the
  // quality signal from the metric.
  confidenceOf: (r, args) =>
    (r as Record<string, unknown>)[verdictKey(args.fieldMap, "confidence")] === "high" ? 1 : 0,
});

export * from "./args";
export * from "./fields";
export * from "./result";
