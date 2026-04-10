import { buildReceiptParsingPrompt } from "../lib/prompts";
import { OcrStrategy, registerStrategy } from "./index";
import { aiExtract } from "../lib/ai-extract";
import { extractText } from "../lib/ocr";
import {
  OcrFunction,
  OcrRequestPayload,
  OcrResultData,
  ReceiptParsingFields,
  ReceiptParsingResult,
} from "../types/ocr.types";

interface ReceiptClaudeResponse {
  vendor: string | null;
  date: string | null;
  totalAmount: string | null;
  currency: string | null;
  lineItems: Array<{ description: string; amount: string }>;
  taxAmount: string | null;
}

const DATE_PATTERNS = [
  /(?:date|dated?|invoice\s*date)[:\s]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
  /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/,
];

const TOTAL_PATTERNS = [
  /(?:total|amount\s*due|grand\s*total|balance\s*due|net\s*amount|sum)[:\s]*[$NGN€£#]?\s*([\d,]+\.?\d*)/i,
  /(?:total|amount)[:\s]*(\d[\d,]*\.?\d*)/i,
];

const TAX_PATTERNS = [/(?:tax|vat|gst|sales\s*tax)[:\s]*[$NGN€£#]?\s*([\d,]+\.?\d*)/i];

const CURRENCY_PATTERNS = [/(?:currency)[:\s]*([A-Z]{3})/i, /(NGN|USD|EUR|GBP|CAD|AUD|JPY|CNY|INR|ZAR)/, /([#$€£¥])/];

const LINE_ITEM_PATTERN = /^(.{3,40}?)\s{2,}[$NGN€£#]?\s*([\d,]+\.?\d+)\s*$/gm;

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  "#": "NGN",
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
};

function extractFirstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function extractVendor(text: string): string | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    if (
      line.length >= 2 &&
      line.length <= 60 &&
      !/^\d/.test(line) &&
      !/^(date|invoice|receipt|tax|total|amount)/i.test(line)
    ) {
      return line;
    }
  }
  return null;
}

function extractLineItems(text: string): Array<{ description: string; amount: string }> {
  const items: Array<{ description: string; amount: string }> = [];
  const pattern = new RegExp(LINE_ITEM_PATTERN.source, "gm");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const description = match[1]!.trim();
    const amount = match[2]!.trim();
    if (description && amount && !/^(total|subtotal|tax|vat|grand|balance|amount)/i.test(description)) {
      items.push({ description, amount });
    }
  }

  return items;
}

function resolveCurrency(extracted: string | null, preferredCurrency?: string): string | null {
  if (preferredCurrency) return preferredCurrency.toUpperCase();
  if (!extracted) return null;
  return CURRENCY_SYMBOL_MAP[extracted] ?? extracted.toUpperCase();
}

const receiptParsingStrategy: OcrStrategy = {
  functionName: OcrFunction.RECEIPT_PARSING,

  validate(_payload: OcrRequestPayload): string[] {
    return [];
  },

  async execute(fileBuffer: Buffer, payload: OcrRequestPayload): Promise<OcrResultData> {
    const fields = payload.fields as ReceiptParsingFields;
    const parseResult = await extractText(fileBuffer);
    const text = parseResult.text;

    let result: ReceiptParsingResult;

    const prompt = buildReceiptParsingPrompt(text, fields.currency);
    const aiResult = await aiExtract<ReceiptClaudeResponse>(prompt.system, prompt.user);

    if (aiResult.success && aiResult.data) {
      result = {
        vendor: aiResult.data.vendor,
        date: aiResult.data.date,
        totalAmount: aiResult.data.totalAmount,
        currency: aiResult.data.currency,
        lineItems: aiResult.data.lineItems ?? [],
        taxAmount: aiResult.data.taxAmount,
        rawText: text,
      };
    } else {
      const vendor = extractVendor(text);
      const date = extractFirstMatch(text, DATE_PATTERNS);
      const totalAmount = extractFirstMatch(text, TOTAL_PATTERNS);
      const taxAmount = extractFirstMatch(text, TAX_PATTERNS);
      const rawCurrency = extractFirstMatch(text, CURRENCY_PATTERNS);
      const currency = resolveCurrency(rawCurrency, fields.currency);
      const lineItems = extractLineItems(text);

      result = { vendor, date, totalAmount, currency, lineItems, taxAmount, rawText: text };
    }

    return { function: OcrFunction.RECEIPT_PARSING, result };
  },
};

registerStrategy(receiptParsingStrategy);
