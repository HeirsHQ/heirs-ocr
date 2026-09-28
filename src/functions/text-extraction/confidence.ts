import { scoreFrom, type ConfidenceAssessment } from "../confidence";
import type { TextExtractionResult } from "./result";

/** No interpretation step to check: the score is the extraction's (applied by the pipeline), zeroed when nothing was read. */
export const assessTextExtraction = (result: TextExtractionResult): ConfidenceAssessment =>
  scoreFrom([result.text.trim() ? null : { factor: 0, reason: "No text was extracted from the document." }]);
