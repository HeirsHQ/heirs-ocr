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

/**
 * `202` from `POST /v1/ocr/:function`. The backend queues any `standard`-sensitivity
 * document over its size/page thresholds rather than processing it on the request,
 * so this — not a result — is the normal reply for a large upload.
 */
export interface OcrAccepted {
  jobId: string;
  statusUrl: string;
}

export type OcrJobStatus = "queued" | "active" | "completed" | "failed";

/**
 * `GET /v1/ocr/jobs/:id`. On completion `result`/`meta` carry the same two fields as
 * the sync success envelope, so both paths render through one code path.
 */
export interface OcrJobRecord {
  requestId?: string;
  jobId: string;
  status: OcrJobStatus;
  function?: string;
  result?: unknown;
  meta?: OcrResponseMeta;
  error?: { code: string; message: string };
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
