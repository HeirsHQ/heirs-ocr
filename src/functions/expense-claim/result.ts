import { z } from "zod";

const expenseLineSchema = z.object({
  date: z.string().nullable(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  amount: z.number().nullable(),
  /** Whether a supporting receipt is attached/referenced for this line. */
  receiptAttached: z.boolean(),
});

export const expenseClaimResultSchema = z.object({
  claimant: z.object({
    name: z.string().nullable(),
    employeeId: z.string().nullable(),
    department: z.string().nullable(),
  }),
  title: z.string().nullable(),
  dateSubmitted: z.string().nullable(),
  currency: z.string().nullable(),
  lineItems: z.array(expenseLineSchema),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  total: z.number().nullable(),
  /** Deterministic post-validation verdict: line items reconcile to the totals. */
  confidence: z.enum(["high", "low"]),
  warnings: z.array(z.string()),
});

export type ExpenseClaimResult = z.infer<typeof expenseClaimResultSchema>;
