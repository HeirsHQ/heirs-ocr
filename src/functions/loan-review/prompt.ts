import { buildSystem, wrapUntrusted } from "../../llm/prompt";
import type { LoanReviewArgs } from "./args";

export type Prompt = { system: string; user: string };

export const buildLoanReviewPrompt = (markdown: string, args: LoanReviewArgs): Prompt => {
  const system = buildSystem([
    "You are a loan underwriting assistant reviewing an application pack.",
    "Extract the borrower (name, date of birth, BVN, employment status, employer),",
    "the requested amount, currency, tenor in months, stated monthly income, and stated",
    "monthly debt obligations. List any risk observations you notice as short riskFlags,",
    "and write a one-paragraph factual summary.",
    `Default currency is ${args.currency}. Use null for any figure not present.`,
    "Do NOT decide approval or compute affordability ratios — report only what the pack states.",
  ]);

  const user = `Review this loan application pack:\n\n${wrapUntrusted("LOAN_PACK", markdown)}`;
  return { system, user };
};
