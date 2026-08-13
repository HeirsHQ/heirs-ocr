import { describe, expect, it } from "vitest";

import { PNG_1x1, deps, fakeProvider, mockLlm, request, runPipeline } from "./support";
import { budgetAnalysis } from "../src/functions/budget-analysis";
import type { BudgetAnalysisResult } from "../src/functions/budget-analysis";

const budget = (over: Partial<BudgetAnalysisResult> = {}): BudgetAnalysisResult => ({
  title: "2026 Budget",
  period: "2026",
  currency: "NGN",
  lineItems: [
    { category: "Marketing", description: null, planned: 100000, actual: 90000, variance: 10000 },
    { category: "Ops", description: null, planned: 200000, actual: 210000, variance: -10000 },
  ],
  totals: { planned: 300000, actual: 300000, variance: 0 },
  confidence: "high",
  warnings: [],
  ...over,
});

describe("BUDGET_ANALYSIS — line items + totals reconciliation", () => {
  it("keeps confidence 'high' when line items reconcile to the totals", async () => {
    const llm = mockLlm([["BUDGET_ANALYSIS_result", budget()]]);
    const { result } = await runPipeline(
      budgetAnalysis,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("BUDGET 2026")] }),
    );
    expect((result as BudgetAnalysisResult).confidence).toBe("high");
    expect((result as BudgetAnalysisResult).warnings).toEqual([]);
  });

  it("downgrades to 'low' with a warning when planned lines don't sum to the total", async () => {
    const llm = mockLlm([
      ["BUDGET_ANALYSIS_result", budget({ totals: { planned: 999999, actual: 300000, variance: 0 } })],
    ]);
    const { result } = await runPipeline(
      budgetAnalysis,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("BUDGET")] }),
    );
    expect((result as BudgetAnalysisResult).confidence).toBe("low");
    expect((result as BudgetAnalysisResult).warnings.length).toBeGreaterThan(0);
  });
});
