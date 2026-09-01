import type { ReceiptParsingResult } from "./result";

/**
 * Collapses a parsed receipt down to one line item, for callers that treat an
 * upload as a single expense rather than an itemized basket
 * (`lineItemMode: "single"` — see args.ts).
 *
 * Deliberately runs *after* `reconcileTotals`, never instead of it. The
 * confidence verdict and warnings are computed from the receipt as printed, so
 * collapsing can't launder a receipt whose items don't add up into a clean-looking
 * single line. Asking the model for one line instead would throw away the only
 * arithmetic we can independently check.
 */
export const collapseToSingleLineItem = (result: ReceiptParsingResult): ReceiptParsingResult => {
  // Already one line: keep it. Its real description ("Jollof Rice") beats anything
  // synthesized from the merchant name.
  if (result.lineItems.length === 1) return result;

  const amount = subtotalAmount(result);
  // Nothing itemized and no amount that could stand in for one — return an empty
  // array rather than invent a zero-value line the caller would have to filter out.
  if (amount == null) return { ...result, lineItems: [] };

  return {
    ...result,
    lineItems: [{ description: describeReceipt(result), qty: 1, unitPrice: amount, total: amount }],
  };
};

/**
 * The amount the synthesized line should carry.
 *
 * Line items sit *below* tax and tip in the schema — the shape is
 * `lineItems → subtotal → (+ tax + tip) → total` — so the collapsed line takes the
 * subtotal, not the grand total. Using `total` would break the very invariant
 * `reconcileTotals` exists to check, and would double-count VAT for any caller that
 * re-adds tax downstream.
 *
 * Falls back through the other ways the subtotal can be recovered, so a thermal
 * receipt that printed only a grand total still collapses to something sane.
 */
const subtotalAmount = (result: ReceiptParsingResult): number | null => {
  if (result.subtotal != null) return result.subtotal;

  const itemsWithTotal = result.lineItems.filter((li) => li.total != null);
  if (itemsWithTotal.length > 0) return itemsWithTotal.reduce((acc, li) => acc + (li.total ?? 0), 0);

  if (result.total != null) return result.total - (result.tax ?? 0) - (result.tip ?? 0);
  return null;
};

/**
 * A description for the synthesized line. The merchant name is what makes a
 * collapsed receipt recognizable in an expense report; the item count keeps the
 * collapse visible rather than silently passing off a basket as one purchase.
 */
const describeReceipt = (result: ReceiptParsingResult): string => {
  const merchant = result.merchant.name?.trim();
  const count = result.lineItems.length;
  if (count === 0) return merchant || "Receipt";
  return merchant ? `${merchant} (${count} items)` : `${count} items`;
};
