import { describe, expect, it } from "vitest";

import { buildReceiptResultSchema, projectReceipt, RECEIPT_FIELD_PATHS } from "../src/functions/receipt-parsing/fields";
import { receiptParsingArgsSchema } from "../src/functions/receipt-parsing/args";
import { buildReceiptParsingPrompt } from "../src/functions/receipt-parsing/prompt";
import { receiptParsing } from "../src/functions/receipt-parsing";
import type { ReceiptParsingResult } from "../src/functions/receipt-parsing/result";

const receipt = (over: Partial<ReceiptParsingResult> = {}): ReceiptParsingResult => ({
  merchant: { name: "Mama Put", address: "12 Awolowo Rd", tin: "TIN-001" },
  dateTime: "2026-09-01T13:20:00",
  currency: "NGN",
  lineItems: [
    { description: "Jollof Rice", qty: 2, unitPrice: 1500, total: 3000 },
    { description: "Water", qty: 1, unitPrice: 225, total: 225 },
  ],
  subtotal: 3225,
  tax: null,
  tip: null,
  total: 3225,
  paymentMethod: "CASH",
  confidence: "high",
  warnings: [],
  ...over,
});

const parseArgs = (raw: unknown) => receiptParsingArgsSchema.safeParse(raw);

describe("receipt fieldMap args", () => {
  it("accepts a partial map", () => {
    // Zod 4 makes an enum-keyed record demand every member, so the map is
    // string-keyed with an explicit path check — a partial selection must parse.
    const parsed = parseArgs({ fieldMap: { total: "amount_due" } });
    expect(parsed.success).toBe(true);
  });

  it("leaves fieldMap undefined when omitted (canonical shape)", () => {
    const parsed = parseArgs({});
    expect(parsed.success && parsed.data.fieldMap).toBeUndefined();
  });

  it("rejects an unknown canonical path", () => {
    const parsed = parseArgs({ fieldMap: { "merchant.phone": "phone" } });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("Unknown receipt field 'merchant.phone'");
  });

  it("rejects two fields mapped onto one output name", () => {
    // Silently dropping one by insertion order would be worse than a 400.
    const parsed = parseArgs({ fieldMap: { subtotal: "amount", total: "amount" } });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("Duplicate output name 'amount'");
  });

  it("rejects an empty map and reserved/invalid names", () => {
    expect(parseArgs({ fieldMap: {} }).success).toBe(false);
    expect(parseArgs({ fieldMap: { total: "__proto__" } }).success).toBe(false);
    expect(parseArgs({ fieldMap: { total: "amount due" } }).success).toBe(false);
    expect(parseArgs({ fieldMap: { total: "9lives" } }).success).toBe(false);
  });

  it("exposes every canonical path the result schema carries", () => {
    expect(RECEIPT_FIELD_PATHS).toContain("merchant.tin");
    expect(RECEIPT_FIELD_PATHS).toContain("lineItems");
    expect(RECEIPT_FIELD_PATHS).toContain("lineItems.unitPrice");
    expect(RECEIPT_FIELD_PATHS).toContain("confidence");
  });
});

describe("projectReceipt", () => {
  it("selects and renames scalars, dropping everything unmapped", () => {
    const out = projectReceipt(receipt(), { "merchant.name": "vendor", total: "amount_due" });
    expect(out).toEqual({
      vendor: "Mama Put",
      amount_due: 3225,
      confidence: "high",
      warnings: [],
    });
    expect(out).not.toHaveProperty("subtotal");
    expect(out).not.toHaveProperty("merchant");
  });

  it("renames within line items and defaults the array name", () => {
    const out = projectReceipt(receipt(), {
      "lineItems.description": "item",
      "lineItems.total": "line_total",
    });
    expect(out.lineItems).toEqual([
      { item: "Jollof Rice", line_total: 3000 },
      { item: "Water", line_total: 225 },
    ]);
  });

  it("renames the array itself and keeps canonical item keys", () => {
    const out = projectReceipt(receipt(), { lineItems: "items" });
    expect(out.items).toEqual([
      { description: "Jollof Rice", qty: 2, unitPrice: 1500, total: 3000 },
      { description: "Water", qty: 1, unitPrice: 225, total: 225 },
    ]);
  });

  it("combines an array rename with per-item renames", () => {
    const out = projectReceipt(receipt(), { lineItems: "items", "lineItems.description": "item" });
    expect(out.items).toEqual([{ item: "Jollof Rice" }, { item: "Water" }]);
  });

  it("always returns the reconciliation verdict, even unmapped", () => {
    // A caller who did not list `warnings` still has to be told the receipt did not
    // add up — otherwise a suspect receipt is indistinguishable from a clean one.
    const suspect = receipt({ confidence: "low", warnings: ["Line items sum to 3225.00 but subtotal is 9999.00."] });
    const out = projectReceipt(suspect, { total: "amount_due" });
    expect(out.confidence).toBe("low");
    expect(out.warnings).toEqual(["Line items sum to 3225.00 but subtotal is 9999.00."]);
  });

  it("renames the verdict when asked", () => {
    const out = projectReceipt(receipt(), { total: "amount_due", confidence: "verdict", warnings: "issues" });
    expect(out.verdict).toBe("high");
    expect(out.issues).toEqual([]);
    expect(out).not.toHaveProperty("confidence");
  });

  it("emits null for a field the receipt did not carry", () => {
    const out = projectReceipt(receipt({ tax: null }), { tax: "vat" });
    expect(out).toHaveProperty("vat", null);
  });
});

describe("buildReceiptResultSchema", () => {
  it("returns the canonical schema when no map is given", () => {
    expect(buildReceiptResultSchema(undefined).safeParse(receipt()).success).toBe(true);
  });

  it("validates exactly what projectReceipt emits", () => {
    // The dynamic schema is what the pipeline checks the response against, so a
    // drift between it and the projection would surface as a 422 on a valid receipt.
    const maps = [
      { "merchant.name": "vendor", total: "amount_due" },
      { "lineItems.description": "item", "lineItems.total": "line_total" },
      { lineItems: "items" },
      { lineItems: "items", "lineItems.qty": "count", confidence: "verdict", warnings: "issues" },
      Object.fromEntries(RECEIPT_FIELD_PATHS.map((p) => [p, p.replace(/\./g, "_")])),
    ];
    for (const fieldMap of maps) {
      const projected = projectReceipt(receipt(), fieldMap);
      const result = buildReceiptResultSchema(fieldMap).safeParse(projected);
      expect(result.success, `${JSON.stringify(fieldMap)} -> ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });
});

describe("receipt parsing definition", () => {
  it("keeps the prompt identical whether or not a fieldMap is supplied", () => {
    // The caller's names must never reach the model: the receipt is parsed and
    // reconciled canonically, then projected (see fields.ts).
    const base = receiptParsingArgsSchema.parse({});
    const mapped = receiptParsingArgsSchema.parse({ fieldMap: { total: "amount_due" } });
    expect(buildReceiptParsingPrompt("RECEIPT", mapped)).toEqual(buildReceiptParsingPrompt("RECEIPT", base));
    expect(JSON.stringify(buildReceiptParsingPrompt("RECEIPT", mapped))).not.toContain("amount_due");
  });

  it("reads confidence through the caller's name for the quality SLI", () => {
    // Reading a fixed `result.confidence` here would see undefined and score every
    // renamed request 0, dragging the low-confidence SLI down for no quality reason.
    const args = receiptParsingArgsSchema.parse({ fieldMap: { total: "amount_due", confidence: "verdict" } });
    const projected = projectReceipt(receipt(), args.fieldMap!);
    expect(receiptParsing.confidenceOf?.(projected, args)).toBe(1);

    const low = projectReceipt(receipt({ confidence: "low" }), args.fieldMap!);
    expect(receiptParsing.confidenceOf?.(low, args)).toBe(0);
  });
});
