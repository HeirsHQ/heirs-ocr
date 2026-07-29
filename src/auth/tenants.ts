import { createHash, randomBytes } from "crypto";

import { env } from "../config/env";
import { getRedis } from "../redis";

/**
 * Database-free multi-tenant registry (docs/regression-and-security.md V1).
 *
 * Tenants live in a single Redis hash `tenants`, keyed by the **sha256 of the
 * API key** — the raw key is never stored, so a Redis dump can't be replayed as
 * credentials. Provisioning writes a field; revoking deletes one (`HDEL`). No
 * relational database, and tenants can be added/removed at runtime without a
 * redeploy.
 *
 * API keys are high-entropy random tokens, so sha256 (not bcrypt/argon2, which
 * exist for low-entropy passwords) is the correct, fast choice — and using the
 * hash as the lookup index means we never string-compare a secret.
 */
export type Tenant = {
  tenantId: string;
  name?: string;
  /** When true, the key is rejected without being deleted (soft revoke). */
  disabled?: boolean;
  /** Per-tenant rate-limit override (requests per window); falls back to env. */
  rateLimit?: number;
  /**
   * Browser origins this tenant may call from. Unused while the service is
   * server-to-server only, but carried so a first-party dashboard can be added
   * later without a schema change.
   */
  allowedOrigins?: string[];
  /**
   * Function keys this tenant may call (e.g. `["RECEIPT_PARSING"]`). Omitted or
   * empty means **all** functions are allowed (backward-compatible). Enforced by
   * the authorize middleware — used to keep, say, `ID_VERIFICATION` off keys that
   * shouldn't touch PII.
   */
  allowedFunctions?: string[];
  createdAt?: string;
};

export const TENANTS_KEY = "tenants";

/** sha256 hex of an API key — the Redis hash field and the cache key. */
export const hashApiKey = (apiKey: string): string => createHash("sha256").update(apiKey).digest("hex");

/** Generates a new random API key (43-char base64url, 256 bits of entropy). */
export const generateApiKey = (): string => randomBytes(32).toString("base64url");

type CacheEntry = { tenant: Tenant; expiresAt: number };
const cache = new Map<string, CacheEntry>();

const cacheTtlMs = () => env.API_KEY_CACHE_TTL_SECONDS * 1000;

/**
 * Resolves an API key to its tenant, or `undefined` if unknown/disabled.
 *
 * Short-TTL positive caching keeps this off the Redis hot path and rides out
 * brief Redis blips. **Throws** if the store is unreachable and nothing is
 * cached — the auth middleware turns that into a fail-closed rejection.
 */
export const resolveTenant = async (apiKey: string): Promise<Tenant | undefined> => {
  const keyHash = hashApiKey(apiKey);

  const hit = cache.get(keyHash);
  if (hit && hit.expiresAt > Date.now()) return hit.tenant.disabled ? undefined : hit.tenant;

  const raw = await getRedis().hget(TENANTS_KEY, keyHash);
  if (!raw) {
    cache.delete(keyHash);
    return undefined;
  }

  const tenant = JSON.parse(raw) as Tenant;
  cache.set(keyHash, { tenant, expiresAt: Date.now() + cacheTtlMs() });
  return tenant.disabled ? undefined : tenant;
};

/** Writes (or overwrites) a tenant under an API key's hash. Used by provisioning. */
export const putTenant = async (apiKey: string, tenant: Tenant): Promise<void> => {
  await getRedis().hset(
    TENANTS_KEY,
    hashApiKey(apiKey),
    JSON.stringify({ ...tenant, createdAt: tenant.createdAt ?? new Date().toISOString() }),
  );
};

/** Removes a tenant by API key (hard revoke). */
export const revokeApiKey = async (apiKey: string): Promise<number> => {
  cache.delete(hashApiKey(apiKey));
  return getRedis().hdel(TENANTS_KEY, hashApiKey(apiKey));
};
