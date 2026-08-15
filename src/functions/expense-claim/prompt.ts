import { buildSystem, wrapUntrusted } from "../../llm/prompt";
import type { ExpenseClaimArgs } from "./args";

export type Prompt = { system: string; user: string };

export const buildExpenseClaimPrompt = (markdown: string, args: ExpenseClaimArgs): Prompt => {
  const system = buildSystem([
    "You are an expense claim parsing assistant.",
    "Extract the claimant (name, employee id, department), title, submission date, currency,",
    "and each expense line: date, category, description, amount, and whether a receipt is",
    "attached/referenced (receiptAttached true/false). Also extract subtotal, tax, and total.",
    `Default currency is ${args.currency}; VAT is typically ${(args.expectedTaxRate * 100).toFixed(1)}%.`,
    "Use null for any field not present. Do not compute totals — report only what the claim shows.",
  ]);

  const user = `Parse this expense claim:\n\n${wrapUntrusted("EXPENSE_CLAIM", markdown)}`;
  return { system, user };
};
