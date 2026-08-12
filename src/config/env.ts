import { z } from "zod";

/**
 * Zod-validated process environment. Import `env` anywhere config is needed;
 * validation runs once at module load and throws on an invalid configuration.
 */
const schema = z
  .object({
    ADMIN_SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(8 * 60 * 60),
    ADMIN_BOOTSTRAP_EMAIL: z.string(),
    // Seeds the first owner account; brute-forceable online (see admin login), so
    // enforce a real minimum length rather than trusting the operator.
    ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12, "ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters"),
    // Tenant-portal session lifetime. Independent of the admin console; defaults to
    // the same 8h interactive-login window.
    TENANT_SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(8 * 60 * 60),
    API_KEY_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30),
    ASYNC_PAGE_THRESHOLD: z.coerce.number().int().positive().default(5),
    ASYNC_SIZE_THRESHOLD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(5 * 1024 * 1024),
    AUTH_ENABLED: z.enum(["true", "false"]).default("true"),
    AZURE_OPENAI_API_KEY: z.string().optional(),
    AZURE_OPENAI_ENDPOINT: z.string().optional(),
    AZURE_OPENAI_API_VERSION: z.string().optional(),
    AZURE_OPENAI_DEPLOYMENT_NAME: z.string().optional(),
    AZURE_OPENAI_ENABLED: z.enum(["true", "false"]).default("false"),
    CORS_ALLOWED_ORIGINS: z.string().default(""),
    // Connection string carrying DB credentials — no default; must be supplied via
    // the environment (12-factor III) so secrets are never baked into source.
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    EXTRACTION_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(7 * 24 * 60 * 60),
    GLM_API_KEY: z.string().optional(),
    GLM_BASE_URL: z.string().default("https://api.z.ai/api/paas/v4"),
    GLM_ENABLED: z.enum(["true", "false"]).default("false"),
    GLM_MAX_PAGES: z.coerce.number().int().positive().default(30),
    GLM_CONCURRENCY: z.coerce.number().int().positive().default(8),
    // Estimated LLM price in NGN per 1,000 tokens, feeding the cost SLI
    // (`ocr_estimated_cost_ngn_total`). 0 disables cost accounting.
    LLM_COST_NGN_PER_1K_TOKENS: z.coerce.number().nonnegative().default(0),
    // A result confidence at or below this (0–1) counts as "low" for the
    // low-confidence quality ratio SLI.
    LOW_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
    MAX_FILE_SIZE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(50 * 1024 * 1024),
    // When set, the /metrics scrape endpoint requires `Authorization: Bearer <token>`.
    // Leave unset only where the port is truly private (e.g. a scrape-only sidecar net).
    METRICS_AUTH_TOKEN: z.string().optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    /** OTLP/HTTP traces endpoint (e.g. http://collector:4318/v1/traces). Unset → traces not exported. */
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
    PORT: z.string().default("8080"),
    RATE_LIMIT_ENABLED: z.enum(["true", "false"]).default("true"),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
    // May carry credentials (redis://:password@host) — no default; supplied via env.
    REDIS_URL: z.string().min(1, "REDIS_URL is required"),
    VERSION: z.string().default("1.0.0"),
  })
  .refine((data) => data.AZURE_OPENAI_ENABLED !== "true" || !!data.AZURE_OPENAI_API_KEY, {
    message: "AZURE_OPENAI_API_KEY is required when AZURE_OPENAI_ENABLED is true",
    path: ["AZURE_OPENAI_API_KEY"],
  })
  .refine((data) => data.GLM_ENABLED !== "true" || !!data.GLM_API_KEY, {
    message: "GLM_API_KEY is required when GLM_ENABLED is true",
    path: ["GLM_API_KEY"],
  })
  // Fail closed at boot: production must never run with auth or rate limiting
  // switched off. These bypasses exist for local dev only — a fat-fingered env var
  // must not be able to open the API in prod.
  .refine((data) => data.NODE_ENV !== "production" || data.AUTH_ENABLED === "true", {
    message: "AUTH_ENABLED must be 'true' when NODE_ENV is 'production'",
    path: ["AUTH_ENABLED"],
  })
  .refine((data) => data.NODE_ENV !== "production" || data.RATE_LIMIT_ENABLED === "true", {
    message: "RATE_LIMIT_ENABLED must be 'true' when NODE_ENV is 'production'",
    path: ["RATE_LIMIT_ENABLED"],
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:", z.flattenError(parsed.error).fieldErrors);
  throw new Error("Invalid environment variables. Check your .env configuration.");
}

export type Env = z.infer<typeof schema>;

export const env: Env = parsed.data;
