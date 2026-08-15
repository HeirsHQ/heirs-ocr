import { expenseClaimResultSchema } from "./result";
import { reconcileExpenseClaim } from "./validate";
import { buildExpenseClaimPrompt } from "./prompt";
import type { ExpenseClaimResult } from "./result";
import type { ExpenseClaimArgs } from "./args";
import type { OcrContext } from "../define";

/**
 * Parses an expense claim, then runs deterministic totals reconciliation and a
 * missing-receipt policy check (see `validate.ts`). The reconciler recomputes the
 * `confidence` verdict from the line amounts, never trusting the model's arithmetic.
 */
export const executeExpenseClaim = async (ctx: OcrContext, args: ExpenseClaimArgs): Promise<ExpenseClaimResult> => {
  const { system, user } = buildExpenseClaimPrompt(ctx.doc.markdown, args);

  const { data } = await ctx.llm.complete({
    system,
    user,
    schema: expenseClaimResultSchema,
    schemaName: "EXPENSE_CLAIM_result",
  });

  return reconcileExpenseClaim(data);
};
