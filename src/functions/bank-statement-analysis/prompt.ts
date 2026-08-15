import { buildSystem, wrapUntrusted } from "../../llm/prompt";
import type { BankStatementAnalysisArgs } from "./args";

export type Prompt = { system: string; user: string };

export const buildBankStatementAnalysisPrompt = (markdown: string, args: BankStatementAnalysisArgs): Prompt => {
  const system = buildSystem([
    "You are a bank statement analysis assistant.",
    "Extract the account holder, account number (as printed), bank name, statement period",
    "(start and end), opening balance, closing balance, currency, and every transaction:",
    "date, description, debit amount, credit amount, and running balance.",
    `Default currency is ${args.currency}. Use null for any field not present.`,
    "Record each transaction's amount under debit OR credit (not both). Do NOT total the",
    "columns or compute balances — report only the figures the statement shows.",
  ]);

  const user = `Analyze this bank statement:\n\n${wrapUntrusted("BANK_STATEMENT", markdown)}`;
  return { system, user };
};
