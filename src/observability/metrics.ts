import type { OcrFunctionKey } from "../functions/define";

/**
 * Per-request metrics envelope. Emitted once per completed request.
 * Two series drive alerts: `providerFallback` (silent upstream degradation) and
 * `lowConfidence` (quality regression after a prompt/model change).
 */
export type RequestMetrics = {
  function: OcrFunctionKey;
  mimeGroup: string;
  pageCount: number;
  provider: string;
  fellBackFrom?: string;
  cached: boolean;
  ingestMs: number;
  extractMs: number;
  interpretMs: number;
  tokensUsed?: number;
  estimatedCostNgn?: number;
  outcome: "success" | "error";
};

export interface Metrics {
  recordRequest(m: RequestMetrics): void;
  /** ocr_provider_fallback_total{from,to} */
  incrementFallback(from: string, to: string): void;
  /** ocr_low_confidence_ratio{function} */
  recordConfidence(fn: OcrFunctionKey, low: boolean): void;
}

// TODO: back with prom-client and expose /metrics.
export const metrics: Metrics = {
  recordRequest: () => {},
  incrementFallback: () => {},
  recordConfidence: () => {},
};
