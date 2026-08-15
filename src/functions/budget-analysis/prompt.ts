import { buildSystem, wrapUntrusted } from "../../llm/prompt";
import type { BudgetAnalysisArgs } from "./args";

export type Prompt = { system: string; user: string };

export const buildBudgetAnalysisPrompt = (markdown: string, args: BudgetAnalysisArgs): Prompt => {
  const system = buildSystem([
    "You are a budget analysis assistant.",
    "Extract the budget's title, period, currency, and every budget line: category,",
    "description, planned amount, actual amount, and variance where shown.",
    "Also extract the overall totals (planned, actual, variance).",
    `Default currency is ${args.currency}. Use null for any field not present.`,
    "Do not compute totals or variance — report only the amounts the document shows.",
  ]);

  const user = `Analyze this budget document:\n\n${wrapUntrusted("BUDGET", markdown)}`;
  return { system, user };
};
