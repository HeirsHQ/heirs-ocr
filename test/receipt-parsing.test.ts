import { describe, expect, it, vi } from "vitest";
// The pipeline records usage counters and a document-registry row as it runs. Stub
// the pool so those writes cannot open a real connection whose failure resolves
// *after* the test ends — that surfaces as a flaky "Closing rpc while
// onUserConsoleLog was pending" teardown error rather than a test failure.
vi.mock("../src/db", () => ({
  query: async () => ({ rows: [], rowCount: 0 }),
  ensureSchema: async () => {},
  whenDbReady: async () => {},
  closeDb: async () => {},
}));

import { PNG_1x1, deps, fakeProvider, mockLlm, request, runPipeline } from "./support";
import { receiptParsing } from "../src/functions/receipt-parsing";
import type { ReceiptParsingResult } from "../src/functions/receipt-parsing";

const receipt = (over: Partial<ReceiptParsingResult>): ReceiptParsingResult => ({
  merchant: { name: "Shop", address: null, tin: null },
  dateTime: null,
  currency: "NGN",
  lineItems: [{ description: "item", qty: 1, unitPrice: 1000, total: 1000 }],
  subtotal: 1000,
  tax: 0,
  tip: null,
  total: 1000,
  paymentMethod: "CASH",
  confidence: "high", // recomputed by reconcileTotals
  warnings: [],
  ...over,
});

describe("RECEIPT_PARSING — parse + deterministic totals reconciliation", () => {
  it("keeps confidence 'high' when totals reconcile", async () => {
    const llm = mockLlm([["RECEIPT_PARSING_result", receipt({})]]);
    const { result } = await runPipeline(
      receiptParsing,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("RECEIPT\nTotal 1000")] }),
    );
    const data = result as ReceiptParsingResult;
    expect(data.confidence).toBe("high");
    expect(data.warnings).toEqual([]);
  });

  it("downgrades to 'low' with a warning when the total doesn't reconcile", async () => {
    const llm = mockLlm([["RECEIPT_PARSING_result", receipt({ total: 9999 })]]);
    const { result } = await runPipeline(
      receiptParsing,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("RECEIPT")] }),
    );
    const data = result as ReceiptParsingResult;
    expect(data.confidence).toBe("low");
    expect(data.warnings.length).toBeGreaterThan(0);
  });

  it("returns the receipt itemized by default", async () => {
    const llm = mockLlm([
      [
        "RECEIPT_PARSING_result",
        receipt({
          lineItems: [
            { description: "Rice", qty: 1, unitPrice: 600, total: 600 },
            { description: "Beans", qty: 1, unitPrice: 400, total: 400 },
          ],
        }),
      ],
    ]);
    const { result } = await runPipeline(
      receiptParsing,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("RECEIPT")] }),
    );
    expect((result as ReceiptParsingResult).lineItems).toHaveLength(2);
  });

  it("collapses to one line when lineItemMode is 'single'", async () => {
    const llm = mockLlm([
      [
        "RECEIPT_PARSING_result",
        receipt({
          lineItems: [
            { description: "Rice", qty: 1, unitPrice: 600, total: 600 },
            { description: "Beans", qty: 1, unitPrice: 400, total: 400 },
          ],
        }),
      ],
    ]);
    const { result } = await runPipeline(
      receiptParsing,
      request(PNG_1x1, { lineItemMode: "single" }, "x.png"),
      deps({ llm, providers: [fakeProvider("RECEIPT")] }),
    );
    const data = result as ReceiptParsingResult;
    expect(data.lineItems).toEqual([{ description: "Shop (2 items)", qty: 1, unitPrice: 1000, total: 1000 }]);
    // Collapsing is a reporting choice — the totals and the verdict are unchanged.
    expect(data.total).toBe(1000);
    expect(data.confidence).toBe("high");
  });

  it("still flags a non-reconciling receipt when collapsed to one line", async () => {
    const llm = mockLlm([
      [
        "RECEIPT_PARSING_result",
        receipt({
          lineItems: [
            { description: "Rice", qty: 1, unitPrice: 600, total: 600 },
            { description: "Beans", qty: 1, unitPrice: 400, total: 400 },
          ],
          subtotal: 9999,
          total: 9999,
        }),
      ],
    ]);
    const { result } = await runPipeline(
      receiptParsing,
      request(PNG_1x1, { lineItemMode: "single" }, "x.png"),
      deps({ llm, providers: [fakeProvider("RECEIPT")] }),
    );
    const data = result as ReceiptParsingResult;
    expect(data.lineItems).toHaveLength(1);
    expect(data.confidence).toBe("low");
    expect(data.warnings.some((w) => /Line items sum/.test(w))).toBe(true);
  });

  it("rejects an unknown lineItemMode", async () => {
    const llm = mockLlm([["RECEIPT_PARSING_result", receipt({})]]);
    await expect(
      runPipeline(
        receiptParsing,
        request(PNG_1x1, { lineItemMode: "itemised" }, "x.png"),
        deps({ llm, providers: [fakeProvider("RECEIPT")] }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });
});
