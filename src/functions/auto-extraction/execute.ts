import {
  AutoDocumentType,
  DOCUMENT_LABELS,
  HANDLERS,
  resolveLabel,
  type AutoDocumentLabel,
  type Handler,
} from "./labels";
import { reconcilePayslip } from "./payslip";
import type { AutoExtractionArgs } from "./args";
import type { AutoExtractionResult } from "./result";
import type { OcrContext } from "../define";

import { executeDocumentClassification } from "../document-classification/execute";
import { executeResumeParsing } from "../resume-parsing/execute";
import { resumeParsingArgsSchema, resumeParsingResultSchema } from "../resume-parsing";
import { executeIdVerification } from "../id-verification/execute";
import { idVerificationArgsSchema } from "../id-verification/args";
import { idVerificationResultSchema } from "../id-verification/result";
import { executeReceiptParsing } from "../receipt-parsing/execute";
import { receiptParsingArgsSchema, receiptParsingResultSchema } from "../receipt-parsing";
import { executeFormDataExtraction } from "../form-data-extraction/execute";
import { buildFormResultSchema } from "../form-data-extraction/result";
import { formDataExtractionArgsSchema } from "../form-data-extraction/args";

/**
 * Identify-on-upload. Classifies the (already-extracted) document against the
 * 16-type catalog, then routes to the matching parser — all on the *same*
 * `ctx.doc`, so extraction runs once and only the interpret step differs per
 * branch.
 *
 * This function is registered as `pii` (the most restrictive sensitivity in the
 * catalog): the detected type may be a Bank/Tax/Payslip/Medical document, and
 * the routing decision isn't known until after classification, so the whole
 * request is handled under PII rules — no extraction caching, never enqueued.
 *
 * On low confidence (or an unmappable label) it returns `documentType:"unknown"`
 * with `data:null` rather than guessing — the caller can then prompt the user to
 * pick a type explicitly.
 */
export const executeAutoExtraction = async (
  ctx: OcrContext,
  args: AutoExtractionArgs,
): Promise<AutoExtractionResult> => {
  const classification = await executeDocumentClassification(ctx, {
    candidateLabels: [...DOCUMENT_LABELS],
    allowUnknown: true,
    minConfidence: args.minConfidence,
    fullDocument: args.fullDocument,
  });

  const summary = {
    confidence: classification.confidence,
    alternatives: classification.alternatives,
    rationale: classification.rationale,
  };

  const label = resolveLabel(classification.label);
  const handler = label ? HANDLERS[label] : undefined;
  if (!label || !handler) {
    return { documentType: "unknown", handler: "none", classification: summary, data: null, validation: null };
  }

  const { kind, data, validation } = await runHandler(ctx, handler, args, label);
  return { documentType: label, handler: kind, classification: summary, data, validation };
};

type HandlerOutput = {
  kind: Exclude<AutoExtractionResult["handler"], "none">;
  data: unknown;
  validation: AutoExtractionResult["validation"];
};

/** Runs the resolved parser on the shared context and validates its result. */
const runHandler = async (
  ctx: OcrContext,
  handler: Handler,
  args: AutoExtractionArgs,
  label: AutoDocumentLabel,
): Promise<HandlerOutput> => {
  switch (handler.kind) {
    case "resume": {
      const data = await executeResumeParsing(ctx, resumeParsingArgsSchema.parse({}));
      return { kind: "resume", data: resumeParsingResultSchema.parse(data), validation: null };
    }
    case "id": {
      const data = await executeIdVerification(ctx, idVerificationArgsSchema.parse({ documentType: "AUTO" }));
      return { kind: "id", data: idVerificationResultSchema.parse(data), validation: null };
    }
    case "receipt": {
      const data = await executeReceiptParsing(ctx, receiptParsingArgsSchema.parse({ currency: args.currency }));
      return { kind: "receipt", data: receiptParsingResultSchema.parse(data), validation: null };
    }
    case "template": {
      const formArgs = formDataExtractionArgsSchema.parse({ fields: handler.fields });
      const data = await executeFormDataExtraction(ctx, formArgs);
      const parsed = buildFormResultSchema(formArgs).parse(data);
      // Type-specific deterministic post-validation for template docs that have
      // checkable arithmetic. Payslip is the first; add others here as needed.
      const validation = label === AutoDocumentType.PAYSLIP ? reconcilePayslip(parsed.fields) : null;
      return { kind: "template", data: parsed, validation };
    }
  }
};
