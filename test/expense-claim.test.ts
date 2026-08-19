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
import { expenseClaim } from "../src/functions/expense-claim";
import type { ExpenseClaimResult } from "../src/functions/expense-claim";

const claim = (over: Partial<ExpenseClaimResult> = {}): ExpenseClaimResult => ({
  claimant: { name: "Ada Obi", employeeId: "E-100", department: "Sales" },
  title: "Client trip",
  dateSubmitted: "2026-07-01",
  currency: "NGN",
  lineItems: [
    { date: "2026-06-30", category: "Transport", description: "Taxi", amount: 5000, receiptAttached: true },
    { date: "2026-06-30", category: "Meals", description: "Lunch", amount: 3000, receiptAttached: true },
  ],
  subtotal: 8000,
  tax: 0,
  total: 8000,
  confidence: "high",
  warnings: [],
  ...over,
});

describe("EXPENSE_CLAIM — parse + reconciliation + policy checks", () => {
  it("reconciles totals to 'high' confidence", async () => {
    const llm = mockLlm([["EXPENSE_CLAIM_result", claim()]]);
    const { result } = await runPipeline(
      expenseClaim,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("EXPENSE CLAIM")] }),
    );
    expect((result as ExpenseClaimResult).confidence).toBe("high");
  });

  it("warns when a line item has no attached receipt", async () => {
    const withMissing = claim({
      lineItems: [{ date: null, category: "Meals", description: "Dinner", amount: 8000, receiptAttached: false }],
    });
    const llm = mockLlm([["EXPENSE_CLAIM_result", withMissing]]);
    const { result } = await runPipeline(
      expenseClaim,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("EXPENSE CLAIM")] }),
    );
    expect((result as ExpenseClaimResult).warnings.some((w) => /receipt/i.test(w))).toBe(true);
  });
});
