import { percent, scoreFrom, type ConfidenceAssessment } from "../confidence";
import type { DocumentClassificationResult } from "./result";

/**
 * The classifier's confidence in the label it committed to. "unknown" scores 0: the
 * caller got no usable label, which is exactly the case a person has to resolve.
 */
export const assessDocumentClassification = (result: DocumentClassificationResult): ConfidenceAssessment =>
  scoreFrom([
    result.label === "unknown"
      ? { factor: 0, reason: "The document did not match any label confidently enough to classify it." }
      : result.confidence < 1
        ? { factor: result.confidence, reason: `Classified as '${result.label}' at ${percent(result.confidence)}.` }
        : null,
  ]);
