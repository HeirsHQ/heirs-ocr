import { buildIdVerificationPrompt } from "../lib/prompts";
import { OcrStrategy, registerStrategy } from "./index";
import { aiExtract } from "../lib/ai-extract";
import { extractText } from "../lib/ocr";
import {
  OcrFunction,
  OcrRequestPayload,
  OcrResultData,
  IdVerificationFields,
  IdVerificationComparisonData,
  IdVerificationResult,
} from "../types/ocr.types";

interface IdVerificationClaudeResponse {
  extractedName: string | null;
  extractedDateOfBirth: string | null;
  extractedIdNumber: string | null;
  extractedDocumentType: string | null;
  comparisonResult?: {
    nameMatch: boolean;
    dobMatch: boolean;
    idNumberMatch: boolean;
    overallMatch: boolean;
  };
}

const VALID_DOCUMENT_TYPES = ["national_id", "passport", "drivers_license"] as const;

const NAME_PATTERNS = [
  /(?:full\s*name|name|surname|last\s*name|first\s*name)[:\s]+([A-Za-z]+(?:\s+[A-Za-z]+)*)/i,
  /(?:holder|bearer|owner)[:\s]+([A-Za-z]+(?:\s+[A-Za-z]+)*)/i,
];

const DOB_PATTERNS = [
  /(?:date\s*of\s*birth|d\.?o\.?b\.?|born|birth\s*date)[:\s]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
  /(?:date\s*of\s*birth|d\.?o\.?b\.?)[:\s]*(\d{4}[\/-]\d{1,2}[\/-]\d{1,2})/i,
];

const ID_NUMBER_PATTERNS = [
  /(?:id\s*(?:no|number|num)|passport\s*(?:no|number)|license\s*(?:no|number)|document\s*(?:no|number))[:\s]*([A-Z0-9-]+)/i,
  /(?:no|number)[:\s]*([A-Z]{1,3}\d{5,})/i,
];

function extractFirstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function normalizeForComparison(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

const idVerificationStrategy: OcrStrategy = {
  functionName: OcrFunction.ID_VERIFICATION,

  validate(payload: OcrRequestPayload): string[] {
    const errors: string[] = [];
    const fields = payload.fields as IdVerificationFields;

    if (!fields.documentType) {
      errors.push("fields.documentType is required");
    } else if (!VALID_DOCUMENT_TYPES.includes(fields.documentType as any)) {
      errors.push(`fields.documentType must be one of: ${VALID_DOCUMENT_TYPES.join(", ")}`);
    }

    if ("comparisonData" in payload && payload.comparisonData) {
      const comparison = payload.comparisonData as IdVerificationComparisonData;
      if (!comparison.fullName || typeof comparison.fullName !== "string") {
        errors.push("comparisonData.fullName is required when comparisonData is provided");
      }
    }

    return errors;
  },

  async execute(fileBuffer: Buffer, payload: OcrRequestPayload): Promise<OcrResultData> {
    const fields = payload.fields as IdVerificationFields;
    const comparisonData =
      "comparisonData" in payload ? (payload.comparisonData as IdVerificationComparisonData | undefined) : undefined;

    const parseResult = await extractText(fileBuffer);
    const text = parseResult.text;

    let extractedName: string | null;
    let extractedDateOfBirth: string | null;
    let extractedIdNumber: string | null;
    let claudeComparison: IdVerificationClaudeResponse["comparisonResult"] | undefined;

    const prompt = buildIdVerificationPrompt(text, fields.documentType, comparisonData);
    const aiResult = await aiExtract<IdVerificationClaudeResponse>(prompt.system, prompt.user);

    if (aiResult.success && aiResult.data) {
      extractedName = aiResult.data.extractedName;
      extractedDateOfBirth = aiResult.data.extractedDateOfBirth;
      extractedIdNumber = aiResult.data.extractedIdNumber;
      claudeComparison = aiResult.data.comparisonResult;
    } else {
      extractedName = extractFirstMatch(text, NAME_PATTERNS);
      extractedDateOfBirth = extractFirstMatch(text, DOB_PATTERNS);
      extractedIdNumber = extractFirstMatch(text, ID_NUMBER_PATTERNS);
    }

    const result: IdVerificationResult = {
      extractedName,
      extractedDateOfBirth,
      extractedIdNumber,
      extractedDocumentType: fields.documentType,
      rawText: text,
    };

    if (comparisonData) {
      if (claudeComparison) {
        // Use Claude's semantic comparison
        result.comparisonResult = claudeComparison;
      } else {
        // Fallback: string-based comparison
        const nameMatch = extractedName
          ? normalizeForComparison(extractedName).includes(normalizeForComparison(comparisonData.fullName)) ||
            normalizeForComparison(comparisonData.fullName).includes(normalizeForComparison(extractedName))
          : false;

        const dobMatch =
          comparisonData.dateOfBirth && extractedDateOfBirth
            ? extractedDateOfBirth.includes(comparisonData.dateOfBirth) ||
              comparisonData.dateOfBirth.includes(extractedDateOfBirth)
            : !comparisonData.dateOfBirth;

        const idNumberMatch =
          comparisonData.idNumber && extractedIdNumber
            ? normalizeForComparison(extractedIdNumber) === normalizeForComparison(comparisonData.idNumber)
            : !comparisonData.idNumber;

        result.comparisonResult = {
          nameMatch,
          dobMatch,
          idNumberMatch,
          overallMatch: nameMatch && dobMatch && idNumberMatch,
        };
      }
    }

    return { function: OcrFunction.ID_VERIFICATION, result };
  },
};

registerStrategy(idVerificationStrategy);
