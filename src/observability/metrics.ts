import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

import { getAllFunctionUsage, getAllTenantUsage } from "./usage";
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

/** Dedicated registry so `/metrics` renders exactly this service's series + Node defaults. */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

const DURATION_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000, 60_000];
const PAGE_BUCKETS = [1, 2, 5, 10, 20, 30, 50, 100];

const requestsTotal = new Counter({
  name: "ocr_requests_total",
  help: "OCR requests processed, by function/provider/outcome.",
  labelNames: ["function", "provider", "mime_group", "cached", "outcome"] as const,
  registers: [registry],
});

const extractDurationMs = new Histogram({
  name: "ocr_extract_duration_ms",
  help: "Extraction stage duration in milliseconds.",
  labelNames: ["function", "provider"] as const,
  buckets: DURATION_BUCKETS_MS,
  registers: [registry],
});

const interpretDurationMs = new Histogram({
  name: "ocr_interpret_duration_ms",
  help: "Interpretation stage duration in milliseconds.",
  labelNames: ["function"] as const,
  buckets: DURATION_BUCKETS_MS,
  registers: [registry],
});

const pageCount = new Histogram({
  name: "ocr_page_count",
  help: "Pages per processed document.",
  labelNames: ["function"] as const,
  buckets: PAGE_BUCKETS,
  registers: [registry],
});

const tokensUsedTotal = new Counter({
  name: "ocr_tokens_used_total",
  help: "LLM tokens consumed, by function/provider.",
  labelNames: ["function", "provider"] as const,
  registers: [registry],
});

const estimatedCostNgnTotal = new Counter({
  name: "ocr_estimated_cost_ngn_total",
  help: "Estimated cost in NGN, by function.",
  labelNames: ["function"] as const,
  registers: [registry],
});

const providerFallbackTotal = new Counter({
  name: "ocr_provider_fallback_total",
  help: "Provider fallbacks — a rising rate signals silent upstream degradation.",
  labelNames: ["from", "to"] as const,
  registers: [registry],
});

// A ratio is a derived query; the SLI is exposed as its two component counters.
const confidenceObservationsTotal = new Counter({
  name: "ocr_confidence_observations_total",
  help: "Confidence observations recorded, by function (denominator of the low-confidence ratio).",
  labelNames: ["function"] as const,
  registers: [registry],
});

const lowConfidenceTotal = new Counter({
  name: "ocr_low_confidence_total",
  help: "Low-confidence observations, by function (numerator of the low-confidence ratio).",
  labelNames: ["function"] as const,
  registers: [registry],
});

export const metrics: Metrics = {
  recordRequest(m) {
    requestsTotal.inc({
      function: m.function,
      provider: m.provider,
      mime_group: m.mimeGroup,
      cached: String(m.cached),
      outcome: m.outcome,
    });
    // Latency/page distributions describe *processed* documents; a failed request
    // has partial or zero timings, so observing it would understate the histograms.
    // The failure is still counted above via `outcome="error"`.
    if (m.outcome === "success") {
      extractDurationMs.observe({ function: m.function, provider: m.provider }, m.extractMs);
      interpretDurationMs.observe({ function: m.function }, m.interpretMs);
      pageCount.observe({ function: m.function }, m.pageCount);
    }
    if (m.tokensUsed) tokensUsedTotal.inc({ function: m.function, provider: m.provider }, m.tokensUsed);
    if (m.estimatedCostNgn) estimatedCostNgnTotal.inc({ function: m.function }, m.estimatedCostNgn);
  },

  incrementFallback(from, to) {
    providerFallbackTotal.inc({ from, to });
  },

  recordConfidence(fn, low) {
    confidenceObservationsTotal.inc({ function: fn });
    if (low) lowConfidenceTotal.inc({ function: fn });
  },
};

/** Prometheus exposition-format content type, for the `/metrics` response header. */
export const metricsContentType = registry.contentType;

/** Renders the current registry in Prometheus text format. */
export const renderMetrics = (): Promise<string> => registry.metrics();

/** A friendly, already-aggregated view of the registry for the admin console. */
export type MetricsSummary = {
  totalRequests: number;
  errorRequests: number;
  /** errors / total, 0 when there is no traffic yet. */
  errorRate: number;
  totalTokens: number;
  providerFallbacks: number;
  /**
   * Requests the per-function rollup actually covers. Below {@link totalRequests}
   * whenever traffic predates `function_usage`, which the console uses to caption
   * the breakdown rather than letting the two look contradictory.
   */
  functionRequests: number;
  /** Per-function request/error/token rollup, plus the low-confidence ratio. */
  byFunction: Array<{
    function: string;
    requests: number;
    errors: number;
    tokens: number;
    lowConfidenceRatio: number;
    /** The ratio's numerator, kept as a count so it can be plotted beside `requests`. */
    lowConfidence: number;
  }>;
};

/**
 * Aggregates the durable `function_usage` rollup (src/observability/usage.ts) into
 * {@link MetricsSummary}.
 *
 * Not read from the Prometheus registry, though every one of these numbers also
 * exists there: that registry is per-process and in-memory, so a console reading it
 * would show totals that reset on every deploy and silently exclude every document
 * the worker processed. Prometheus stays the operational view (histograms, labels,
 * scrape-interval resolution); this is the business view, and both are fed from the
 * same pipeline call sites so they agree within a process lifetime.
 *
 * **Throws** if the store is unreachable — the admin route surfaces that rather than
 * rendering a confident page of zeroes.
 */
export const getMetricsSummary = async (): Promise<MetricsSummary> => {
  const [tenants, usage] = await Promise.all([getAllTenantUsage(), getAllFunctionUsage()]);

  const sumTenants = (pick: (u: (typeof tenants)[number]) => number): number =>
    tenants.reduce((acc, u) => acc + pick(u), 0);
  const sumFunctions = (pick: (u: (typeof usage)[number]) => number): number =>
    usage.reduce((acc, u) => acc + pick(u), 0);

  // Headline totals come from `tenant_usage`, which has counted every request since
  // the service began. `function_usage` arrived later, so summing it reported a
  // total that silently omitted everything processed before it existed — the console
  // showed 1 request against a tenant with 22. The per-function breakdown below is
  // still the narrower record; `functionRequests` reports how much it covers so the
  // page can say so rather than presenting the two as if they agreed.
  const totalRequests = sumTenants((u) => u.requests);
  const errorRequests = sumTenants((u) => u.errors);

  return {
    totalRequests,
    errorRequests,
    errorRate: totalRequests ? errorRequests / totalRequests : 0,
    totalTokens: sumTenants((u) => u.tokens),
    // Only `function_usage` records fallbacks, so this tile carries its narrower window.
    providerFallbacks: sumFunctions((u) => u.fallbacks),
    functionRequests: sumFunctions((u) => u.requests),
    // `getAllFunctionUsage` already sorts busiest-first.
    byFunction: usage.map((u) => ({
      function: u.function,
      requests: u.requests,
      errors: u.errors,
      tokens: u.tokens,
      lowConfidenceRatio: u.confidenceObservations ? u.lowConfidence / u.confidenceObservations : 0,
      lowConfidence: u.lowConfidence,
    })),
  };
};
