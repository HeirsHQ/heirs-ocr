import { buildBudgetAnalysisPrompt } from "./prompt";
import { budgetAnalysisResultSchema } from "./result";
import { reconcileBudget } from "./validate";
import type { BudgetAnalysisArgs } from "./args";
import type { BudgetAnalysisResult } from "./result";
import type { OcrContext } from "../define";

/**
 * Extracts a budget, then runs deterministic totals reconciliation (see
 * `validate.ts`). The model reports only what the document shows; the reconciler
 * recomputes the `confidence` verdict from the line-item sums, never trusting the
 * model's own arithmetic.
 */
export const executeBudgetAnalysis = async (
  ctx: OcrContext,
  args: BudgetAnalysisArgs,
): Promise<BudgetAnalysisResult> => {
  const { system, user } = buildBudgetAnalysisPrompt(ctx.doc.markdown, args);

  const { data } = await ctx.llm.complete({
    system,
    user,
    schema: budgetAnalysisResultSchema,
    schemaName: "BUDGET_ANALYSIS_result",
  });

  return reconcileBudget(data);
};
