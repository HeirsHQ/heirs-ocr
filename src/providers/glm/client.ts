/**
 * Typed client for GLM-OCR's `layout_parsing` endpoint. Not
 * multipart — `file` is a URL or base64 data URI. Prefer base64 data URIs and
 * page-splitting (see chunker) to sidestep the 50 MB / page-cap limits and to
 * avoid exposing the blob store.
 */

export type LayoutDetailLabel = "image" | "text" | "formula" | "table";

/** One layout region. `bbox_2d` is normalized 0–1. Table blocks return HTML in `content`. */
export type LayoutDetail = {
  index: number;
  label: LayoutDetailLabel;
  bbox_2d: [number, number, number, number];
  content: string;
  height: number;
  width: number;
};

export type LayoutParsingResponse = {
  id: string;
  created: number;
  model: string;
  md_results: string;
  /** One array per page, each holding that page's blocks. */
  layout_details: LayoutDetail[][];
  layout_visualization?: string[];
  data_info: { num_pages: number; pages: { width: number; height: number }[] };
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  request_id: string;
};

export type LayoutParsingRequest = {
  model: "glm-ocr";
  /** URL or base64 data URI (`data:image/png;base64,...`). */
  file: string;
  return_crop_images?: boolean;
  need_layout_visualization?: boolean;
  /** 1-based inclusive PDF page range — the chunking lever. */
  start_page_id?: number;
  end_page_id?: number;
  /** 6–64 chars, unique. Carries our job id for tracing/idempotency. */
  request_id?: string;
  /** 6–128 chars. Send a hashed tenant id, never a raw one. */
  user_id?: string;
};

export type GlmClientOptions = {
  apiKey: string;
  baseUrl: string;
  maxRetries?: number;
  timeoutMs?: number;
};

export class GlmClient {
  constructor(private readonly opts: GlmClientOptions) {}

  /** POST /layout_parsing with bounded retries on 429/5xx. */
  async layoutParsing(_req: LayoutParsingRequest, _signal?: AbortSignal): Promise<LayoutParsingResponse> {
    const url = `${this.opts.baseUrl}/layout_parsing`;
    // TODO: fetch(url, { Authorization: `Bearer ${this.opts.apiKey}` }) with retry/backoff.
    throw new Error(`GlmClient.layoutParsing: not implemented (${url})`);
  }
}
