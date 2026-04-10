import { OcrFunction, OcrRequestPayload, OcrResultData, FormDataExtractionFields } from "../types/ocr.types";
import { buildFormDataExtractionPrompt } from "../lib/prompts";
import { OcrStrategy, registerStrategy } from "./index";
import { aiExtract } from "../lib/ai-extract";
import { extractText } from "../lib/ocr";

interface FormDataClaudeResponse {
  fields: Record<string, string>;
}

const KEY_VALUE_PATTERN = /^([^:=\n]{1,60})[:\s=]+(.+)$/gm;

function extractKeyValuePairs(text: string, targetFields?: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  let match: RegExpExecArray | null;

  const pattern = new RegExp(KEY_VALUE_PATTERN.source, "gm");
  while ((match = pattern.exec(text)) !== null) {
    const key = match[1]!.trim();
    const value = match[2]!.trim();

    if (!key || !value) continue;

    if (targetFields && targetFields.length > 0) {
      const normalizedKey = key.toLowerCase();
      const matchesTarget = targetFields.some(
        (tf) => normalizedKey.includes(tf.toLowerCase()) || tf.toLowerCase().includes(normalizedKey),
      );
      if (!matchesTarget) continue;
    }

    fields[key] = value;
  }

  return fields;
}

const formDataExtractionStrategy: OcrStrategy = {
  functionName: OcrFunction.FORM_DATA_EXTRACTION,

  validate(payload: OcrRequestPayload): string[] {
    const errors: string[] = [];
    const fields = payload.fields as FormDataExtractionFields;

    if (fields.targetFields !== undefined && !Array.isArray(fields.targetFields)) {
      errors.push("fields.targetFields must be an array of strings when provided");
    }

    return errors;
  },

  async execute(fileBuffer: Buffer, payload: OcrRequestPayload): Promise<OcrResultData> {
    const fields = payload.fields as FormDataExtractionFields;
    const parseResult = await extractText(fileBuffer);

    let extractedFields: Record<string, string>;

    const prompt = buildFormDataExtractionPrompt(parseResult.text, fields.targetFields);
    const aiResult = await aiExtract<FormDataClaudeResponse>(prompt.system, prompt.user);

    if (aiResult.success && aiResult.data) {
      extractedFields = aiResult.data.fields;
    } else {
      extractedFields = extractKeyValuePairs(parseResult.text, fields.targetFields);
    }

    return {
      function: OcrFunction.FORM_DATA_EXTRACTION,
      result: {
        fields: extractedFields,
        rawText: parseResult.text,
        pages: parseResult.pages,
        extractionMethod: parseResult.method,
      },
    };
  },
};

registerStrategy(formDataExtractionStrategy);
