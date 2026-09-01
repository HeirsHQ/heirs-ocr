import { receiptParsingResultSchema } from "./result";
import { buildReceiptParsingPrompt } from "./prompt";
import type { ReceiptParsingResult } from "./result";
import type { ReceiptParsingArgs } from "./args";
import { collapseToSingleLineItem } from "./collapse";
import { reconcileTotals } from "./validate";
import type { OcrContext } from "../define";

/**
 * Parses a receipt, then runs deterministic totals reconciliation
 * (see `validate.ts`). Handwritten and thermal-printed receipts are exactly
 * where GLM-OCR beats Tesseract hardest.
 *
 * The model reports only what the receipt shows (told not to compute totals);
 * `reconcileTotals` then recomputes the `confidence` verdict and warnings
 * deterministically, never trusting the model's own arithmetic.
 *
 * The receipt is parsed itemized regardless of `args.lineItemMode`, and only
 * collapsed to a single line afterwards — reconciliation has to see the printed
 * lines to have anything to check. The prompt is identical in both modes.
 */
export const executeReceiptParsing = async (
  ctx: OcrContext,
  args: ReceiptParsingArgs,
): Promise<ReceiptParsingResult> => {
  const { system, user } = buildReceiptParsingPrompt(ctx.doc.markdown, args);

  const { data } = await ctx.llm.complete({
    system,
    user,
    schema: receiptParsingResultSchema,
    schemaName: "RECEIPT_PARSING_result",
  });

  const reconciled = reconcileTotals(data);
  return args.lineItemMode === "single" ? collapseToSingleLineItem(reconciled) : reconciled;
};
