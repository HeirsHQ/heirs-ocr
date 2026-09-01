import { z } from "zod";

export const receiptParsingArgsSchema = z.object({
  /** ISO 4217 code. NGN default for the Nigerian market. */
  currency: z.string().length(3).default("NGN").describe("ISO 4217 currency code, e.g. NGN."),
  /** Expected VAT rate for the deterministic post-validation. Nigeria: 7.5%. */
  expectedTaxRate: z.number().min(0).max(1).default(0.075).describe("Expected VAT rate as a fraction. Nigeria: 0.075."),
  /**
   * How the upload should be reported. `"multiple"` (default) returns the receipt
   * itemized as printed; `"single"` collapses it to one line carrying the whole
   * receipt — what expense-claim style callers want when the individual items
   * don't matter, only that the receipt is worth ₦X at this merchant.
   *
   * This is a *reporting* choice, not a parsing one: the receipt is always parsed
   * itemized and only collapsed afterwards, so the totals reconciliation in
   * `validate.ts` still checks the real printed lines either way.
   */
  lineItemMode: z
    .enum(["multiple", "single"])
    .default("multiple")
    .describe(
      "How to report the upload: 'multiple' returns the receipt itemized as printed; " +
        "'single' collapses it to one line carrying the subtotal. Totals reconciliation " +
        "runs against the printed lines either way.",
    ),
});

export type ReceiptParsingArgs = z.infer<typeof receiptParsingArgsSchema>;
