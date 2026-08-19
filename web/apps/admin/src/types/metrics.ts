/** Admin observability shapes, mirroring the backend endpoints under `/admin/api`. */

/** `GET /api/admin/health`. */
export interface HealthStatus {
  blob: boolean;
  postgres: boolean;
  providers: { blobStorage: boolean; tesseract: boolean; glm: boolean; azureOpenAI: boolean };
  azureOpenAI: boolean;
  blobStorage: boolean;
  glm: boolean;
  tesseract: boolean;
  redis: boolean;
  status: string;
  version: string;
}

/** One job's state, mirroring `JobStatus` in src/jobs/queue.ts. */
export type JobStatus = "queued" | "active" | "completed" | "failed";

/** `GET /api/admin/queue`. */
export interface QueueStats {
  counts: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  /**
   * Newest first, across every state the counts above cover — not just the ones in
   * flight. Narrowing this to `active | failed` was how the table came to be empty
   * while the Completed tile read 1.
   */
  recent: Array<{ jobId: string; status: JobStatus; function: string; tenantId: string }>;
}

export interface FunctionMetric {
  function: string;
  requests: number;
  errors: number;
  tokens: number;
  lowConfidenceRatio: number;
  /**
   * The ratio's numerator as a count. Its denominator is `confidenceObservations`,
   * not `requests` — only functions that expose a confidence signal record one — so
   * this is a count of requests, comparable to `requests` and `errors`, while the
   * ratio is not.
   */
  lowConfidence: number;
}

/** `GET /api/admin/metrics/summary`. */
export interface MetricsSummary {
  totalRequests: number;
  errorRequests: number;
  errorRate: number;
  totalTokens: number;
  providerFallbacks: number;
  /**
   * How many of `totalRequests` the per-function breakdown covers. Lower whenever
   * traffic predates the `function_usage` rollup, which the page captions rather
   * than showing two totals that appear to disagree.
   */
  functionRequests: number;
  byFunction: FunctionMetric[];
}

/** One time bucket of `GET /api/admin/metrics/timeseries`. */
export interface TimeseriesPoint {
  /** ISO-8601 bucket start, UTC. */
  ts: string;
  requests: number;
  errors: number;
  /** 0-1. Zero on an empty bucket, so the series has no gap. */
  errorRate: number;
  /** Null when no timed request landed in the bucket — not zero. */
  p50Ms: number | null;
  p95Ms: number | null;
}

/**
 * `GET /api/admin/metrics/timeseries`.
 *
 * The only admin read with a time dimension. Sourced from the request log, so it is a
 * rolling window that ages out with retention and counts refused calls — it will not
 * tie out against the lifetime totals in {@link MetricsSummary}.
 */
export interface MetricsTimeseries {
  bucket: "hour" | "day";
  since: string;
  until: string;
  points: TimeseriesPoint[];
}

/** One row of `GET /api/admin/usage`. */
export interface TenantUsage {
  tenantId: string;
  requests: number;
  errors: number;
  tokens: number;
}

/**
 * One row of `GET /api/admin/usage/by-function` — a tenant's volume on one function.
 *
 * Distinct from {@link TenantUsage} in two ways the page has to say out loud: it is a
 * rolling window (request logs age out with retention, these do not accumulate for
 * ever) and it counts calls that were refused before reaching the pipeline.
 */
export interface TenantFunctionUsage {
  tenantId: string;
  functionKey: string;
  requests: number;
  errors: number;
}
