import { OcrFunction, OcrRequestPayload, OcrResultData } from "../types/ocr.types";
import { buildDocumentClassificationPrompt } from "../lib/prompts";
import { extractText, classifyDocument } from "../lib/ocr";
import { OcrStrategy, registerStrategy } from "./index";
import { aiExtract } from "../lib/ai-extract";

interface DocumentClassificationClaudeResponse {
  detectedType: string | null;
  confidence: number;
  matchedKeywords: string[];
}

const documentClassificationStrategy: OcrStrategy = {
  functionName: OcrFunction.DOCUMENT_CLASSIFICATION,

  validate(_payload: OcrRequestPayload): string[] {
    return [];
  },

  async execute(fileBuffer: Buffer, _payload: OcrRequestPayload): Promise<OcrResultData> {
    const parseResult = await extractText(fileBuffer);

    let detectedType: string | null;
    let confidence: number;
    let matchedKeywords: string[];

    const prompt = buildDocumentClassificationPrompt(parseResult.text);
    const aiResult = await aiExtract<DocumentClassificationClaudeResponse>(prompt.system, prompt.user);

    if (aiResult.success && aiResult.data) {
      detectedType = aiResult.data.detectedType;
      confidence = aiResult.data.confidence;
      matchedKeywords = aiResult.data.matchedKeywords;
    } else {
      const classification = classifyDocument(parseResult.text);
      detectedType = classification.detectedType;
      confidence = classification.confidence;
      matchedKeywords = classification.matchedKeywords;
    }

    return {
      function: OcrFunction.DOCUMENT_CLASSIFICATION,
      result: {
        detectedType,
        confidence,
        matchedKeywords,
        pages: parseResult.pages,
        extractionMethod: parseResult.method,
      },
    };
  },
};

registerStrategy(documentClassificationStrategy);
