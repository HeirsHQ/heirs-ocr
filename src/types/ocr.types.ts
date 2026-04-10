export const OcrFunction = {
  SIGNING: "SIGNING",
  ID_VERIFICATION: "ID_VERIFICATION",
  DOCUMENT_CLASSIFICATION: "DOCUMENT_CLASSIFICATION",
  FORM_DATA_EXTRACTION: "FORM_DATA_EXTRACTION",
  RECEIPT_PARSING: "RECEIPT_PARSING",
  TEXT_EXTRACTION: "TEXT_EXTRACTION",
} as const;

export type OcrFunctionName = (typeof OcrFunction)[keyof typeof OcrFunction];
export type ExtractionMethod = "text" | "ocr" | "text+claude" | "text+gpt" | "ocr+claude" | "ocr+gpt";

export interface SigningFields {
  signerName: string;
  expectedDate?: string;
}

export interface SigningComparisonData {
  name: string;
  date?: string;
}

export interface SigningResult {
  signatureDetected: boolean;
  signatureConfidence: number;
  signerNameFound: boolean;
  dateFound: boolean;
  extractedSignerName: string | null;
  extractedDate: string | null;
  comparisonResult?: {
    nameMatch: boolean;
    dateMatch: boolean;
    overallMatch: boolean;
  };
}

export interface IdVerificationFields {
  documentType: "national_id" | "passport" | "drivers_license";
}

export interface IdVerificationComparisonData {
  fullName: string;
  dateOfBirth?: string;
  idNumber?: string;
}

export interface IdVerificationResult {
  extractedName: string | null;
  extractedDateOfBirth: string | null;
  extractedIdNumber: string | null;
  extractedDocumentType: string | null;
  rawText: string;
  comparisonResult?: {
    nameMatch: boolean;
    dobMatch: boolean;
    idNumberMatch: boolean;
    overallMatch: boolean;
  };
}

export interface DocumentClassificationFields {
  expectedType?: string;
}

export interface DocumentClassificationResult {
  documentTitle: string | null;
  detectedType: string | null;
  isExpectedType: boolean;
  confidence: number;
  matchedKeywords: string[];
  pages: number;
  extractionMethod: ExtractionMethod;
}

export interface FormDataExtractionFields {
  targetFields?: string[];
}

export interface FormDataExtractionResult {
  fields: Record<string, string>;
  rawText: string;
  pages: number;
  extractionMethod: ExtractionMethod;
}

export interface ReceiptParsingFields {
  currency?: string;
}

export interface ReceiptParsingResult {
  vendor: string | null;
  date: string | null;
  totalAmount: string | null;
  currency: string | null;
  lineItems: Array<{ description: string; amount: string }>;
  taxAmount: string | null;
  rawText: string;
}

export interface TextExtractionFields {
  language?: string;
}

export interface TextExtractionResult {
  text: string;
  pages: number;
  extractionMethod: ExtractionMethod;
}

export type OcrRequestPayload =
  | {
      function: typeof OcrFunction.SIGNING;
      fields: SigningFields;
      comparisonData?: SigningComparisonData;
    }
  | {
      function: typeof OcrFunction.ID_VERIFICATION;
      fields: IdVerificationFields;
      comparisonData?: IdVerificationComparisonData;
    }
  | {
      function: typeof OcrFunction.DOCUMENT_CLASSIFICATION;
      fields: DocumentClassificationFields;
    }
  | {
      function: typeof OcrFunction.FORM_DATA_EXTRACTION;
      fields: FormDataExtractionFields;
    }
  | {
      function: typeof OcrFunction.RECEIPT_PARSING;
      fields: ReceiptParsingFields;
    }
  | {
      function: typeof OcrFunction.TEXT_EXTRACTION;
      fields: TextExtractionFields;
    };

export type OcrResultData =
  | { function: typeof OcrFunction.SIGNING; result: SigningResult }
  | { function: typeof OcrFunction.ID_VERIFICATION; result: IdVerificationResult }
  | { function: typeof OcrFunction.DOCUMENT_CLASSIFICATION; result: DocumentClassificationResult }
  | { function: typeof OcrFunction.FORM_DATA_EXTRACTION; result: FormDataExtractionResult }
  | { function: typeof OcrFunction.RECEIPT_PARSING; result: ReceiptParsingResult }
  | { function: typeof OcrFunction.TEXT_EXTRACTION; result: TextExtractionResult };
