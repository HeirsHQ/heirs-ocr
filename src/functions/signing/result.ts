import { z } from "zod";

const signatureBlockSchema = z.object({
  label: z.string(),
  page: z.number().int(),
  /**
   * Normalized 0–1 region of the mark. Present only on the region-detection path
   * (a `seals`-capable provider located the block). The whole-page vision fallback
   * judges an entire page at once and has no reliable geometry, so it omits this
   * rather than inventing a box — see `confidence`/`warnings`.
   */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  signed: z.boolean(),
  signatoryName: z.string().optional(),
  signedDate: z.string().optional(),
  hasSeal: z.boolean(),
  cropUrl: z.string().optional(),
});

export const signingResultSchema = z.object({
  fullyExecuted: z.boolean(),
  blocks: z.array(signatureBlockSchema),
  unsignedBlocks: z.array(z.string()),
  /**
   * `high` only when a `seals`-capable provider located the signature regions and
   * each was judged from its own crop. `low` marks a degraded run — the whole-page
   * fallback, or a geometry probe that could not run — so a caller never mistakes
   * "we could not see it" for "it is not signed". Always read this before acting
   * on `fullyExecuted`.
   */
  confidence: z.enum(["high", "low"]),
  warnings: z.array(z.string()),
});

export type SigningResult = z.infer<typeof signingResultSchema>;
