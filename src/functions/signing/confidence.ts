import { FAILED_CHECK_FACTOR, scoreFrom, verdictDeductions, type ConfidenceAssessment } from "../confidence";
import type { SigningResult } from "./result";

/**
 * "low" marks a degraded whole-page run (see execute.ts); its warnings say why. A
 * precise run that located no signature slot at all is also suspect: either the
 * document has none, or the cues missed them — `fullyExecuted: false` alone cannot
 * tell a caller which.
 */
export const assessSigning = (result: SigningResult): ConfidenceAssessment =>
  scoreFrom([
    ...verdictDeductions(result.confidence, result.warnings, "Signature regions could not be located precisely."),
    result.confidence === "high" && result.blocks.length === 0
      ? { factor: FAILED_CHECK_FACTOR, reason: "No signature blocks were located on the document." }
      : null,
  ]);
