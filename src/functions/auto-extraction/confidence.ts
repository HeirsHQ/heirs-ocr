import { combine, percent, scoreFrom, verdictDeductions, type ConfidenceAssessment } from "../confidence";
import { assessFormDataExtraction } from "../form-data-extraction/confidence";
import type { FormDataExtractionResult } from "../form-data-extraction/result";
import { assessIdVerification } from "../id-verification/confidence";
import type { IdVerificationResult } from "../id-verification/result";
import { assessReceiptParsing } from "../receipt-parsing/confidence";
import type { ReceiptParsingResult } from "../receipt-parsing/result";
import { assessResumeParsing } from "../resume-parsing/confidence";
import type { ResumeParsingResult } from "../resume-parsing/result";
import { HANDLERS, resolveLabel } from "./labels";
import type { AutoExtractionResult } from "./result";

/**
 * Routing confidence × the routed parser's own assessment (× payslip arithmetic when
 * it ran). `data` was validated against the parser's schema in execute.ts, so the
 * casts below hold. An unrouted document extracted nothing and scores 0.
 */
export const assessAutoExtraction = (result: AutoExtractionResult): ConfidenceAssessment => {
  if (result.handler === "none") {
    return scoreFrom([{ factor: 0, reason: "The document type was not recognized, so nothing was extracted." }]);
  }

  const { confidence } = result.classification;
  const routing = scoreFrom([
    confidence < 1
      ? { factor: confidence, reason: `Identified as '${result.documentType}' at ${percent(confidence)}.` }
      : null,
  ]);
  const validation = result.validation
    ? scoreFrom(
        verdictDeductions(result.validation.confidence, result.validation.warnings, "Payslip figures do not add up."),
      )
    : scoreFrom([]);

  return combine(routing, assessData(result), validation);
};

const assessData = (result: AutoExtractionResult): ConfidenceAssessment => {
  switch (result.handler) {
    case "resume":
      return assessResumeParsing(result.data as ResumeParsingResult);
    case "id":
      return assessIdVerification(result.data as IdVerificationResult);
    case "receipt":
      return assessReceiptParsing(result.data as ReceiptParsingResult, {});
    case "template": {
      const label = resolveLabel(result.documentType);
      const handler = label ? HANDLERS[label] : undefined;
      const fields = handler?.kind === "template" ? [...handler.fields] : [];
      return assessFormDataExtraction(result.data as FormDataExtractionResult, { fields });
    }
    default:
      return scoreFrom([]);
  }
};
