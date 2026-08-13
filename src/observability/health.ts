import { getRedis } from "../redis";
import { query } from "../db";
import { env } from "../config/env";

/**
 * Backing-store reachability, shared by the Kubernetes readiness probe (`/readyz`)
 * and the admin console's health panel (`GET /admin/api/health`) so the two can
 * never disagree about whether the service is actually able to serve.
 *
 * Both dependencies are hard: Postgres backs the tenant registry, sessions, and
 * billing; Redis backs rate limiting and the job queue. A probe that answers `ok`
 * without touching either — as this one previously did — keeps a pod with a dead
 * pool in the load-balancer rotation indefinitely and lets a rolling deploy against
 * a broken dependency go fully green.
 */

export type DependencyHealth = {
  redis: boolean;
  postgres: boolean;
};

export const checkDependencies = async (): Promise<DependencyHealth> => {
  const [redis, postgres] = await Promise.all([
    getRedis()
      .ping()
      .then((pong) => pong === "PONG")
      .catch(() => false),
    query("SELECT 1")
      .then(() => true)
      .catch(() => false),
  ]);
  return { redis, postgres };
};

/** Which interpretation providers are configured. Informational, not a readiness gate. */
export const providerStatus = () => ({
  tesseract: true, // always available (bundled)
  glm: env.GLM_ENABLED === "true",
  azureOpenAI: env.AZURE_OPENAI_ENABLED === "true",
});
