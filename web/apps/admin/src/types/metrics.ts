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
