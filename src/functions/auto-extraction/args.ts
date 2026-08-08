import { z } from "zod";

export const autoExtractionArgsSchema = z.object({
  /** Below this classifier confidence the document is reported as `unknown` (no guessed routing). */
  minConfidence: z.number().min(0).max(1).default(0.5),
  /** Classify from the whole document rather than page 1 only (costlier, more robust for multi-page). */
  fullDocument: z.boolean().default(false),
  /** Default currency passed through to the receipt parser when a receipt is detected (ISO 4217). */
  currency: z.string().length(3).default("NGN"),
});

export type AutoExtractionArgs = z.infer<typeof autoExtractionArgsSchema>;
