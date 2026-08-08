import { defineOcrFunction, OcrFunction } from "../define";
import { autoExtractionArgsSchema } from "./args";
import { autoExtractionResultSchema } from "./result";
import { executeAutoExtraction } from "./execute";

export const autoExtraction = defineOcrFunction({
  key: OcrFunction.AUTO_EXTRACTION,
  description:
    "Identify the uploaded document against the supported catalog, then route it to the matching parser (classify → extract).",
  accepts: ["pdf", "image", "docx"],
  // Only `text` is required so classification + extraction always run even when
  // the layout/tables-capable provider (GLM) is disabled; the resume/receipt
  // parsers degrade gracefully to markdown when bboxes/tables are absent.
  requires: ["text"],
  // Most-restrictive: a detected Bank/Tax/Payslip/Medical doc must be handled
  // under PII rules (no caching, no async queue, redacted logs).
  sensitivity: "pii",
  maxPages: 20,
  argsSchema: autoExtractionArgsSchema,
  resultSchema: autoExtractionResultSchema,
  execute: executeAutoExtraction,
});

export * from "./args";
export * from "./result";
export * from "./labels";
