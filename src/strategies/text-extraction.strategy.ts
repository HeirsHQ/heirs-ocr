import { ExtractionMethod, OcrFunction, OcrRequestPayload, OcrResultData } from "../types/ocr.types";
import { OcrStrategy, registerStrategy } from "./index";
import { buildTextExtraction } from "../lib/prompts";
import { aiExtract } from "../lib/ai-extract";
import { extractText } from "../lib/ocr";

interface TextExtractionAIResponse {
  extractedText: string;
}

const textExtractionStrategy: OcrStrategy = {
  functionName: OcrFunction.TEXT_EXTRACTION,

  validate(_payload: OcrRequestPayload): string[] {
    return [];
  },

  async execute(fileBuffer: Buffer, payload: OcrRequestPayload): Promise<OcrResultData> {
    const fields = payload.fields as { language?: string };
    const parseResult = await extractText(fileBuffer, { ocrLanguage: fields.language });

    let text: string;
    let extractionMethod: ExtractionMethod;

    const prompt = buildTextExtraction(parseResult.text, fields.language);
    const aiResult = await aiExtract<TextExtractionAIResponse>(prompt.system, prompt.user);

    if (aiResult.success && aiResult.data) {
      text = aiResult.data.extractedText;
      extractionMethod = `${parseResult.method}+${aiResult.method}` as ExtractionMethod;
    } else {
      text = parseResult.text;
      extractionMethod = parseResult.method;
    }

    return {
      function: OcrFunction.TEXT_EXTRACTION,
      result: {
        text,
        pages: parseResult.pages,
        extractionMethod,
      },
    };
  },
};

registerStrategy(textExtractionStrategy);
