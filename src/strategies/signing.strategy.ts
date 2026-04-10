import { extractText, detectSignature } from "../lib/ocr";
import { OcrStrategy, registerStrategy } from "./index";
import { buildSigningPrompt } from "../lib/prompts";
import { aiExtract } from "../lib/ai-extract";
import {
  OcrFunction,
  OcrRequestPayload,
  OcrResultData,
  SigningFields,
  SigningComparisonData,
  SigningResult,
} from "../types/ocr.types";

interface SigningClaudeResponse {
  signatureDetected: boolean;
  signatureConfidence: number;
  signerNameFound: boolean;
  dateFound: boolean;
  extractedSignerName: string | null;
  extractedDate: string | null;
}

const signingStrategy: OcrStrategy = {
  functionName: OcrFunction.SIGNING,

  validate(payload: OcrRequestPayload): string[] {
    const errors: string[] = [];
    const fields = payload.fields as SigningFields;

    if (!fields.signerName || typeof fields.signerName !== "string") {
      errors.push("fields.signerName is required and must be a string");
    }

    if ("comparisonData" in payload && payload.comparisonData) {
      const comparison = payload.comparisonData as SigningComparisonData;
      if (!comparison.name || typeof comparison.name !== "string") {
        errors.push("comparisonData.name is required when comparisonData is provided");
      }
    }

    return errors;
  },

  async execute(fileBuffer: Buffer, payload: OcrRequestPayload): Promise<OcrResultData> {
    const fields = payload.fields as SigningFields;
    const comparisonData =
      "comparisonData" in payload ? (payload.comparisonData as SigningComparisonData | undefined) : undefined;

    const parseResult = await extractText(fileBuffer);

    let signatureDetected: boolean;
    let signatureConfidence: number;
    let signerNameFound: boolean;
    let dateFound: boolean;
    let extractedSignerName: string | null;
    let extractedDate: string | null;

    // Primary: AI extraction (Claude preferred, GPT fallback)
    const prompt = buildSigningPrompt(parseResult.text, fields.signerName, comparisonData);
    const aiResult = await aiExtract<SigningClaudeResponse>(prompt.system, prompt.user);

    if (aiResult.success && aiResult.data) {
      signatureDetected = aiResult.data.signatureDetected;
      signatureConfidence = aiResult.data.signatureConfidence;
      signerNameFound = aiResult.data.signerNameFound;
      dateFound = aiResult.data.dateFound;
      extractedSignerName = aiResult.data.extractedSignerName;
      extractedDate = aiResult.data.extractedDate;
    } else {
      // Fallback: regex extraction
      const sigDetection = detectSignature(parseResult.text, parseResult.pages, parseResult.method);
      signatureDetected = sigDetection.signed;
      signatureConfidence = sigDetection.confidence;

      const normalizedText = parseResult.text.toLowerCase();
      signerNameFound = normalizedText.includes(fields.signerName.toLowerCase());
      extractedSignerName = signerNameFound ? fields.signerName : null;

      const datePattern = /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/;
      const dateMatch = parseResult.text.match(datePattern);
      dateFound = !!dateMatch;
      extractedDate = dateMatch?.[0] ?? null;
    }

    const result: SigningResult = {
      signatureDetected,
      signatureConfidence,
      signerNameFound,
      dateFound,
      extractedSignerName,
      extractedDate,
    };

    if (comparisonData) {
      const nameMatch = extractedSignerName
        ? extractedSignerName.toLowerCase().includes(comparisonData.name.toLowerCase()) ||
          comparisonData.name.toLowerCase().includes(extractedSignerName.toLowerCase())
        : false;
      const dateMatchResult = comparisonData.date
        ? extractedDate
          ? extractedDate.includes(comparisonData.date) || comparisonData.date.includes(extractedDate)
          : false
        : true;
      result.comparisonResult = {
        nameMatch,
        dateMatch: dateMatchResult,
        overallMatch: nameMatch && dateMatchResult && signatureDetected,
      };
    }

    return { function: OcrFunction.SIGNING, result };
  },
};

registerStrategy(signingStrategy);
