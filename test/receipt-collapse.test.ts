import { describe, expect, it } from "vitest";

import { collapseToSingleLineItem } from "../src/functions/receipt-parsing/collapse";
import { reconcileTotals } from "../src/functions/receipt-parsing/validate";
import type { ReceiptParsingResult } from "../src/functions/receipt-parsing/result";

const baseReceipt = (overrides: Partial<ReceiptParsingResult> = {}): ReceiptParsingResult => ({
  merchant: { name: "Corner Shop", address: null, tin: null },
  dateTime: null,
  currency: "NGN",
  lineItems: [
    { description: "Rice", qty: 1, unitPrice: 200, total: 200 },
    { description: "Beans", qty: 1, unitPrice: 100, total: 100 },
  ],
  subtotal: 300,
  tax: 0,
  tip: 0,
  total: 300,
  paymentMethod: null,
  confidence: "high",
  warnings: [],
  ...overrides,
});

describe("collapseToSingleLineItem", () => {
  it("collapses a basket to one line carrying the subtotal", () => {
    const result = collapseToSingleLineItem(baseReceipt());
    expect(result.lineItems).toEqual([{ description: "Corner Shop (2 items)", qty: 1, unitPrice: 300, total: 300 }]);
  });

  it("leaves the totals untouched", () => {
    const result = collapseToSingleLineItem(baseReceipt({ subtotal: 300, tax: 22.5, total: 322.5 }));
    expect(result.subtotal).toBe(300);
    expect(result.tax).toBe(22.5);
    expect(result.total).toBe(322.5);
  });

  it("takes the subtotal, not the grand total, so tax is not double-counted", () => {
    const result = collapseToSingleLineItem(baseReceipt({ subtotal: 300, tax: 22.5, total: 322.5 }));
    expect(result.lineItems[0].total).toBe(300);
  });

  it("keeps the collapsed line consistent with reconciliation", () => {
    const collapsed = collapseToSingleLineItem(baseReceipt({ subtotal: 300, tax: 22.5, total: 322.5 }));
    // Re-running reconciliation over the collapsed shape must still hold: the one
    // line sums to the subtotal, and subtotal + tax + tip is the total.
    expect(reconcileTotals(collapsed).confidence).toBe("high");
  });

  it("preserves a real single-item description instead of synthesizing one", () => {
    const receipt = baseReceipt({
      lineItems: [{ description: "Jollof Rice", qty: 1, unitPrice: 300, total: 300 }],
    });
    expect(collapseToSingleLineItem(receipt).lineItems[0].description).toBe("Jollof Rice");
  });

  it("synthesizes a line for an unitemized receipt that printed only a total", () => {
    const receipt = baseReceipt({ lineItems: [], subtotal: null, tax: 75, tip: null, total: 1075 });
    // subtotal recovered as total - tax - tip, so the line stays below the tax line.
    expect(collapseToSingleLineItem(receipt).lineItems).toEqual([
      { description: "Corner Shop", qty: 1, unitPrice: 1000, total: 1000 },
    ]);
  });

  it("sums the line items when no subtotal was printed", () => {
    const receipt = baseReceipt({ subtotal: null, tax: null, tip: null, total: null });
    expect(collapseToSingleLineItem(receipt).lineItems[0].total).toBe(300);
  });

  it("falls back to a bare item count when the merchant is unknown", () => {
    const receipt = baseReceipt({ merchant: { name: null, address: null, tin: null } });
    expect(collapseToSingleLineItem(receipt).lineItems[0].description).toBe("2 items");
  });

  it("emits no line at all when there is no amount to carry", () => {
    const receipt = baseReceipt({ lineItems: [], subtotal: null, tax: null, tip: null, total: null });
    expect(collapseToSingleLineItem(receipt).lineItems).toEqual([]);
  });

  it("does not launder a receipt whose items don't add up", () => {
    // Reconciliation runs first (as in execute.ts), so the low verdict and its
    // warning survive the collapse.
    const reconciled = reconcileTotals(baseReceipt({ subtotal: 500, total: 500 }));
    const collapsed = collapseToSingleLineItem(reconciled);
    expect(collapsed.confidence).toBe("low");
    expect(collapsed.warnings.some((w) => /Line items sum/.test(w))).toBe(true);
  });
});
