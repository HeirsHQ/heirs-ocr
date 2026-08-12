import { z } from "zod";

const transactionSchema = z.object({
  date: z.string().nullable(),
  description: z.string().nullable(),
  debit: z.number().nullable(),
  credit: z.number().nullable(),
  balance: z.number().nullable(),
});

/** Raw fields the model extracts; the summary + verdict are computed deterministically. */
export const bankStatementExtractionSchema = z.object({
  accountHolder: z.string().nullable(),
  accountNumber: z.string().nullable(),
  bank: z.string().nullable(),
  period: z.object({ start: z.string().nullable(), end: z.string().nullable() }),
  openingBalance: z.number().nullable(),
  closingBalance: z.number().nullable(),
  currency: z.string().nullable(),
  transactions: z.array(transactionSchema),
});

export const bankStatementAnalysisResultSchema = bankStatementExtractionSchema.extend({
  /** Computed from the extracted transactions — never the model's own arithmetic. */
  summary: z.object({
    totalCredits: z.number(),
    totalDebits: z.number(),
    netFlow: z.number(),
    transactionCount: z.number().int(),
  }),
  /** Deterministic verdict: opening + credits − debits reconciles to closing. */
  confidence: z.enum(["high", "low"]),
  warnings: z.array(z.string()),
});

export type BankStatementAnalysisResult = z.infer<typeof bankStatementAnalysisResultSchema>;
