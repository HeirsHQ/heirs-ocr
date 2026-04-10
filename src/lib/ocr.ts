import Tesseract from "tesseract.js";
import { PDFParse } from "pdf-parse";

import { ExtractionMethod } from "../types/ocr.types";

export type OcrLanguage = "eng" | "esp" | "fra" | "ger" | "ita" | "por" | "rus" | "span";

export interface DocumentParseResult {
  text: string;
  pages: number;
  method: ExtractionMethod;
}

export interface DocumentClassification {
  detectedType: string | null;
  confidence: number;
  matchedKeywords: string[];
}

export interface SignatureDetection {
  signed: boolean;
  confidence: number;
  reason: string;
}

export interface DocumentAnalysisResult {
  extractedText: string;
  pages: number;
  extractionMethod: ExtractionMethod;
  classification: DocumentClassification;
  signature: SignatureDetection;
}

export interface DocumentAnalysisOptions {
  minCharsPerPage?: number;
  ocrLanguage?: string;
  expectedDocumentType?: string;
}

// !DO NOT CHANGE Legacy types for backward compatibility
export type ResumeParseResult = DocumentParseResult;
export type ResumeParseOptions = { minCharsPerPage?: number; ocrLanguage?: string };

const DEFAULT_MIN_CHARS_PER_PAGE = 50;
const MIN_CLASSIFICATION_CONFIDENCE = 0.3;

const DOCUMENT_KEYWORDS: Record<string, string[]> = {
  letter_of_recommendation: [
    "letter of recommendation",
    "referee",
    "recommend",
    "applicant",
    "professional capacity",
    "character",
    "endorsement",
  ],
  code_of_conduct: [
    "code of conduct",
    "professional standards",
    "academic integrity",
    "behaviour",
    "disciplinary",
    "misconduct",
    "ethical",
  ],
  photo_media_consent: ["photo", "media consent", "photograph", "recording", "publicity", "image rights", "likeness"],
  disclaimer_indemnity: [
    "disclaimer",
    "indemnity",
    "liability",
    "indemnification",
    "hold harmless",
    "waiver",
    "assumption of risk",
  ],
};

const SIGNATURE_INDICATORS = [
  /signature[:\s]/i,
  /signed\s*(by)?[:\s]/i,
  /date[:\s]*\d{1,2}/i,
  /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/, // date pattern
  /(print\s*name|full\s*name|name\s*of)[:\s]*[a-z]{2,}/i,
  /witness[:\s]/i,
];

function isPdf(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString() === "%PDF";
}

async function pdfToImages(buffer: Buffer): Promise<Buffer[]> {
  const { pdf } = await (Function('return import("pdf-to-img")')() as Promise<typeof import("pdf-to-img")>);
  const images: Buffer[] = [];
  for await (const page of await pdf(buffer, { scale: 2 })) {
    images.push(Buffer.from(page));
  }
  return images;
}

export async function extractText(
  buffer: Buffer,
  options?: { minCharsPerPage?: number; ocrLanguage?: string },
): Promise<DocumentParseResult> {
  const minChars = options?.minCharsPerPage ?? DEFAULT_MIN_CHARS_PER_PAGE;
  const lang = options?.ocrLanguage ?? "eng";

  if (!isPdf(buffer)) {
    const { data } = await Tesseract.recognize(buffer, lang);
    return {
      text: data.text.trim(),
      pages: 1,
      method: "ocr",
    };
  }

  const pdfParse = new PDFParse({ data: buffer });
  const pdfData = await pdfParse.getText();
  const extractedText = pdfData.text.trim();
  const pageCount = pdfData.pages.length;

  if (extractedText.length >= minChars * pageCount) {
    return {
      text: extractedText,
      pages: pageCount,
      method: "text",
    };
  }

  const images = await pdfToImages(buffer);
  const ocrResults = await Promise.all(images.map((img) => Tesseract.recognize(img, lang)));
  const combinedText = ocrResults
    .map((r) => r.data.text)
    .join("\n")
    .trim();

  return {
    text: combinedText,
    pages: images.length || pageCount,
    method: "ocr",
  };
}

export function classifyDocument(extractedText: string): DocumentClassification {
  const normalizedText = extractedText.toLowerCase();
  let bestType: string | null = null;
  let bestScore = 0;
  let bestMatched: string[] = [];

  for (const [docType, keywords] of Object.entries(DOCUMENT_KEYWORDS)) {
    const matched = keywords.filter((kw) => normalizedText.includes(kw));
    const score = matched.length / keywords.length;
    if (score > bestScore) {
      bestScore = score;
      bestType = docType;
      bestMatched = matched;
    }
  }

  return {
    detectedType: bestScore >= MIN_CLASSIFICATION_CONFIDENCE ? bestType : null,
    confidence: Math.round(bestScore * 100) / 100,
    matchedKeywords: bestMatched,
  };
}

export function detectSignature(extractedText: string, _pages: number, _method: ExtractionMethod): SignatureDetection {
  const normalizedText = extractedText.toLowerCase();

  const matchedSignals = SIGNATURE_INDICATORS.filter((pattern) => pattern.test(normalizedText));

  const hasDateFilled = /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(normalizedText);
  const hasNameFilled = /(print\s*name|full\s*name|name\s*of)[:\s]*[a-z]{2,}/i.test(normalizedText);

  let confidence = 0;
  if (matchedSignals.length >= 3) confidence = 0.9;
  else if (matchedSignals.length >= 2) confidence = 0.7;
  else if (matchedSignals.length >= 1) confidence = 0.5;
  else confidence = 0.2;

  if (hasDateFilled && hasNameFilled) {
    confidence = Math.min(confidence + 0.15, 1.0);
  }

  const signed = confidence >= 0.5;
  const reason = signed
    ? `Detected ${matchedSignals.length} signature indicator(s)${hasNameFilled ? ", name field filled" : ""}${hasDateFilled ? ", date field filled" : ""}`
    : `No clear signature indicators found (${matchedSignals.length} weak signal(s))`;

  return {
    signed,
    confidence: Math.round(confidence * 100) / 100,
    reason,
  };
}

export async function analyzeDocument(
  buffer: Buffer,
  options?: DocumentAnalysisOptions,
): Promise<DocumentAnalysisResult> {
  const parseResult = await extractText(buffer, {
    minCharsPerPage: options?.minCharsPerPage,
    ocrLanguage: options?.ocrLanguage,
  });

  const classification = classifyDocument(parseResult.text);
  const signature = detectSignature(parseResult.text, parseResult.pages, parseResult.method);

  return {
    extractedText: parseResult.text,
    pages: parseResult.pages,
    extractionMethod: parseResult.method,
    classification,
    signature,
  };
}

/**
 * @deprecated Use `extractText` instead. Kept for backward compatibility.
 */
export async function parseResume(buffer: Buffer, options?: ResumeParseOptions): Promise<ResumeParseResult> {
  return extractText(buffer, options);
}
