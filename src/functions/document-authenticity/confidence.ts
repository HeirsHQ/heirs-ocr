import { scoreFrom, type ConfidenceAssessment } from "../confidence";
import type { DocumentAuthenticityResult } from "./result";

/**
 * Confidence the file can be accepted as unaltered: `1 − score`, the complement of
 * the analyzer's own noisy-OR suspicion score, with each non-`info` signal listed as
 * a reason. An unsupported format was never analyzed, so it scores 0.
 */
export const assessDocumentAuthenticity = (result: DocumentAuthenticityResult): ConfidenceAssessment => {
  if (result.verdict === "inconclusive") {
    return scoreFrom([
      { factor: 0, reason: "Tamper analysis could not run on this file, so the verdict is inconclusive." },
    ]);
  }
  const flagged = result.signals.filter((s) => s.severity !== "info");
  if (flagged.length === 0) return scoreFrom([]);
  return scoreFrom([
    { factor: 1 - result.score, reason: `Tamper verdict '${result.verdict}'.` },
    // The score above already weighs every signal; these only explain it.
    ...flagged.map((s) => ({ factor: 1, reason: `${s.code}: ${s.detail}` })),
  ]);
};
