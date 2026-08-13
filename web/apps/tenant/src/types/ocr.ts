/** Mirrors the OCR backend contract (`GET /v1/ocr/functions`, `POST /v1/ocr/:function`). */

export interface OcrCatalogEntry {
  key: string;
  description: string;
  accepts: string[];
  requires: string[];
  sensitivity: string;
  maxPages: number;
  /** JSON Schema for the args object (used to hint/validate the args field). */
  argsSchema: unknown;
  /** Absent for dynamic-schema functions (e.g. FORM_DATA_EXTRACTION). */
  resultSchema?: unknown;
}

export interface OcrCatalog {
  functions: OcrCatalogEntry[];
}

export interface OcrResponseMeta {
  provider: string;
  fellBackFrom: string | null;
  pageCount: number;
  cached: boolean;
  confidence?: number;
  durationMs: number;
  tokensUsed?: number;
}

export interface OcrSuccess {
  requestId: string;
  function: string;
  result: unknown;
  meta: OcrResponseMeta;
}

export interface OcrErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
    details?: unknown;
  };
}
