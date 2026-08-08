import { z } from "zod";

/**
 * The auto-routing envelope. `data` is the underlying parser's own result and
 * its shape depends on `handler` — so it's typed as `unknown` here and validated
 * against the concrete parser schema inside `execute` before it's returned.
 * Callers switch on `handler` (or `documentType`) to narrow it.
 */
export const autoExtractionResultSchema = z.object({
  /** One of the 16 catalog labels, or "unknown" when confidence was too low to route. */
  documentType: z.string(),
  /** Which extractor produced `data` ("none" when unrouted). */
  handler: z.enum(["resume", "id", "receipt", "template", "none"]),
  classification: z.object({
    confidence: z.number().min(0).max(1),
    alternatives: z.array(z.object({ label: z.string(), confidence: z.number().min(0).max(1) })),
    rationale: z.string(),
  }),
  /** Parser result (shape per `handler`); null when unrouted. */
  data: z.unknown(),
  /** Type-specific deterministic validation (currently Payslip totals); null when none ran. */
  validation: z
    .object({
      confidence: z.enum(["high", "low"]),
      warnings: z.array(z.string()),
    })
    .nullable(),
});

export type AutoExtractionResult = z.infer<typeof autoExtractionResultSchema>;
