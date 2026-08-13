import { describe, expect, it } from "vitest";

import { PNG_1x1, deps, fakeProvider, mockLlm, request, runPipeline } from "./support";
import { loanReview } from "../src/functions/loan-review";
import type { LoanReviewResult } from "../src/functions/loan-review";

// The LLM fixture is the *extraction* (raw figures); affordability + recommendation
// are computed deterministically by the function.
const extraction = (over: Record<string, unknown> = {}) => ({
  borrower: { name: "Ada Obi", dateOfBirth: null, bvn: null, employmentStatus: "employed", employer: "Acme" },
  requestedAmount: 1_000_000,
  currency: "NGN",
  tenorMonths: 12,
  income: { monthly: 500_000 },
  obligations: { monthlyDebt: 100_000 },
  riskFlags: [],
  summary: "Applicant in stable employment.",
  ...over,
});

describe("LOAN_REVIEW — extract + deterministic affordability", () => {
  it("recommends approval when debt-to-income is comfortable", async () => {
    const llm = mockLlm([["LOAN_REVIEW_extraction", extraction()]]);
    const { result } = await runPipeline(
      loanReview,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("LOAN APPLICATION")] }),
    );
    const data = result as LoanReviewResult;
    expect(data.affordability.debtToIncome).toBeCloseTo(0.2); // 100k / 500k
    expect(data.recommendation).toBe("approve");
    expect(data.confidence).toBe("high");
  });

  it("reports insufficient-data when income is missing", async () => {
    const llm = mockLlm([["LOAN_REVIEW_extraction", extraction({ income: { monthly: null } })]]);
    const { result } = await runPipeline(
      loanReview,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("LOAN APPLICATION")] }),
    );
    const data = result as LoanReviewResult;
    expect(data.recommendation).toBe("insufficient-data");
    expect(data.affordability.debtToIncome).toBeNull();
    expect(data.confidence).toBe("low");
  });
});
