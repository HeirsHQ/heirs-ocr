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
import { bankStatementAnalysis } from "../src/functions/bank-statement-analysis";
import type { BankStatementAnalysisResult } from "../src/functions/bank-statement-analysis";

// LLM fixture is the *extraction*; the summary + reconciliation verdict are computed.
const extraction = (over: Record<string, unknown> = {}) => ({
  accountHolder: "Ada Obi",
  accountNumber: "0123456789",
  bank: "GTB",
  period: { start: "2026-06-01", end: "2026-06-30" },
  openingBalance: 100_000,
  closingBalance: 150_000,
  currency: "NGN",
  transactions: [
    { date: "2026-06-05", description: "Salary", debit: null, credit: 80_000, balance: 180_000 },
    { date: "2026-06-10", description: "Rent", debit: 30_000, credit: null, balance: 150_000 },
  ],
  ...over,
});

describe("BANK_STATEMENT_ANALYSIS — transactions + computed summary", () => {
  it("computes totals and reconciles opening→closing to 'high' confidence", async () => {
    const llm = mockLlm([["BANK_STATEMENT_ANALYSIS_extraction", extraction()]]);
    const { result } = await runPipeline(
      bankStatementAnalysis,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("STATEMENT")] }),
    );
    const data = result as BankStatementAnalysisResult;
    expect(data.summary).toEqual({ totalCredits: 80_000, totalDebits: 30_000, netFlow: 50_000, transactionCount: 2 });
    expect(data.confidence).toBe("high"); // 100k + 80k − 30k = 150k = closing
  });

  it("downgrades to 'low' when the balances don't reconcile", async () => {
    const llm = mockLlm([["BANK_STATEMENT_ANALYSIS_extraction", extraction({ closingBalance: 999_999 })]]);
    const { result } = await runPipeline(
      bankStatementAnalysis,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("STATEMENT")] }),
    );
    const data = result as BankStatementAnalysisResult;
    expect(data.confidence).toBe("low");
    expect(data.warnings.length).toBeGreaterThan(0);
  });
});
