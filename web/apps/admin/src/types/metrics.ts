/** Admin observability shapes, mirroring the backend endpoints under `/admin/api`. */

/** `GET /api/admin/health`. */
export interface HealthStatus {
  status: string;
  redis: boolean;
  postgres: boolean;
  providers: { tesseract: boolean; glm: boolean; azureOpenAI: boolean };
  version: string;
}

/** `GET /api/admin/queue`. */
export interface QueueStats {
  counts: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  recent: Array<{ jobId: string; status: "active" | "failed"; function: string; tenantId: string }>;
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
  byFunction: FunctionMetric[];
}

/** One row of `GET /api/admin/usage`. */
export interface TenantUsage {
  tenantId: string;
  requests: number;
  errors: number;
  tokens: number;
}
