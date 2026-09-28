import { completeness, isPresent, scoreFrom, verdictDeductions, type ConfidenceAssessment } from "../confidence";
import { selectedReceiptField, verdictKey, type ReceiptParsingOutput } from "./fields";
import type { ReceiptParsingArgs } from "./args";

/** The fields a receipt is parsed for; each scores only when the caller's `fieldMap` selected it. */
const KEY_FIELDS: Record<string, string> = {
  "merchant.name": "merchant name",
  dateTime: "date",
  total: "total",
  lineItems: "line items",
};

/**
 * Totals-reconciliation verdict and its warnings, then key-field fill rate. Read
 * through `verdictKey` / `selectedReceiptField` so a caller renaming or dropping
 * fields cannot detach the score from the receipt they were actually sent.
 */
export const assessReceiptParsing = (
  output: ReceiptParsingOutput,
  args: Pick<ReceiptParsingArgs, "fieldMap">,
): ConfidenceAssessment => {
  const record = output as Record<string, unknown>;
  const verdict = record[verdictKey(args.fieldMap, "confidence")] === "high" ? "high" : "low";
  const warnings = (record[verdictKey(args.fieldMap, "warnings")] as string[] | undefined) ?? [];

  const found: Record<string, boolean> = {};
  for (const [path, label] of Object.entries(KEY_FIELDS)) {
    const selected = selectedReceiptField(output, args.fieldMap, path);
    if (selected) found[label] = isPresent(selected.value);
  }

  return scoreFrom([...verdictDeductions(verdict, warnings, "Receipt totals do not reconcile."), completeness(found)]);
};
