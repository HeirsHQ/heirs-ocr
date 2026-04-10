import { DocumentClassificationFields, OcrFunction, OcrRequestPayload, OcrResultData } from "../types/ocr.types";
import { buildDocumentClassificationPrompt } from "../lib/prompts";
import { extractText, classifyDocument } from "../lib/ocr";
import { OcrStrategy, registerStrategy } from "./index";
import { aiExtract } from "../lib/ai-extract";

interface DocumentClassificationClaudeResponse {
  documentTitle: string | null;
  detectedType: string | null;
  confidence: number;
  matchedKeywords: string[];
}

const documentClassificationStrategy: OcrStrategy = {
  functionName: OcrFunction.DOCUMENT_CLASSIFICATION,

  validate(_payload: OcrRequestPayload): string[] {
    return [];
  },

  async execute(fileBuffer: Buffer, payload: OcrRequestPayload): Promise<OcrResultData> {
    const parseResult = await extractText(fileBuffer);
    const fields = payload.fields as DocumentClassificationFields;

    if (!fields.expectedType) {
      return {
        function: OcrFunction.DOCUMENT_CLASSIFICATION,
        result: {
          documentTitle: null,
          detectedType: null,
          isExpectedType: false,
          confidence: 0,
          matchedKeywords: [],
          pages: parseResult.pages,
          extractionMethod: parseResult.method,
        },
      };
    }

    let documentTitle: string | null = null;
    let detectedType: string | null;
    let confidence: number;
    let matchedKeywords: string[];

    const prompt = buildDocumentClassificationPrompt(parseResult.text, fields.expectedType);
    const aiResult = await aiExtract<DocumentClassificationClaudeResponse>(prompt.system, prompt.user);

    if (aiResult.success && aiResult.data) {
      documentTitle = aiResult.data.documentTitle;
      detectedType = aiResult.data.detectedType;
      confidence = aiResult.data.confidence;
      matchedKeywords = aiResult.data.matchedKeywords;
    } else {
      const classification = classifyDocument(parseResult.text);
      detectedType = classification.detectedType;
      confidence = classification.confidence;
      matchedKeywords = classification.matchedKeywords;
    }

    const isExpectedType =
      !!detectedType && detectedType.toLowerCase() === fields.expectedType.toLowerCase();

    return {
      function: OcrFunction.DOCUMENT_CLASSIFICATION,
      result: {
        documentTitle,
        detectedType,
        isExpectedType,
        confidence,
        matchedKeywords,
        pages: parseResult.pages,
        extractionMethod: parseResult.method,
      },
    };
  },
};

registerStrategy(documentClassificationStrategy);
