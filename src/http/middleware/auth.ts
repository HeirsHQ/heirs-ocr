import type { NextFunction, Request, Response } from "express";
import { randomBytes } from "crypto";

import { SESSION_COOKIE as TENANT_SESSION_COOKIE, resolveSession } from "../../auth/tenant-session";
import { isTenantOrgDisabled, resolveTenant } from "../../auth/tenants";
import { logger } from "../../observability/logger";
import { parseCookies } from "./admin-auth";
import { env } from "../../config/env";
import { OcrError } from "../errors";

/**
 * OCR authentication (docs/regression-and-security.md V1). Two ways in, both
 * resolving to the same tenant identity that scopes rate limiting, caching, and
 * subscription:
 *
 *   1. **API key** — direct callers send `Authorization: Bearer <key>` (or
 *      `X-API-Key`); the key is hashed and looked up in the tenant registry. This
 *      path also carries per-key scope (`allowedFunctions`).
 *   2. **Tenant session** — the first-party web app calls in-app with the tenant's
 *      httpOnly `tenant_session` cookie (see src/auth/tenant-session.ts). No API key
 *      is exposed to the browser; the session resolves to the org's `tenantId`. Org
 *      access is then gated by subscription + rate limit downstream (there is no
 *      per-key `allowedFunctions` on a session — it's the whole org).
 *
 * The API key takes precedence when both are present.
 *
 * **Fail-closed:** unlike the rate limiter, if the store is unreachable we reject
 * (503) rather than admit. A short-TTL cache in the registry rides out brief blips.
 *
 * `AUTH_ENABLED=false` bypasses auth entirely (local dev only) — never in prod.
 */
export const auth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  req.requestId = req.requestId ?? `req_${randomBytes(8).toString("hex")}`;

  if (env.AUTH_ENABLED !== "true") {
    req.tenantId = "anonymous";
    next();
    return;
  }

  const key = extractApiKey(req);

  try {
    if (key) {
      const tenant = await resolveTenant(key);
      if (!tenant) {
        next(new OcrError("UNAUTHORIZED", "Invalid or revoked API key"));
        return;
      }
      req.tenantId = tenant.tenantId;
      req.tenant = tenant;
      next();
      return;
    }

    // No API key — accept a first-party tenant session cookie instead (in-app OCR).
    const token = parseCookies(req.headers?.cookie)[TENANT_SESSION_COOKIE];
    if (token) {
      const session = await resolveSession(token);
      if (session) {
        // An operator who disables/revokes a tenant's keys means the whole org, not
        // just its direct API traffic — previously `disabled` was hardcoded false
        // here, so the org's users kept running documents through the portal.
        if (await isTenantOrgDisabled(session.tenantId)) {
          next(new OcrError("FORBIDDEN", "This organisation is disabled"));
          return;
        }
        req.tenantId = session.tenantId;
        // Org-level access: no per-key allowedFunctions — subscription + rate limit gate it.
        req.tenant = { tenantId: session.tenantId, disabled: false };
        next();
        return;
      }
    }

    next(
      new OcrError(
        "UNAUTHORIZED",
        "Missing credentials (send 'Authorization: Bearer <key>' / 'X-API-Key', or sign in to the app)",
      ),
    );
  } catch (err) {
    // Fail closed: the auth store is a hard dependency for a security control.
    logger.error("auth store unavailable", { err: err instanceof Error ? err.message : String(err) });
    next(new OcrError("PROVIDER_UNAVAILABLE", "Authentication store unavailable", { retryable: true }));
  }
};

/** Reads the key from `Authorization: Bearer <key>` or the `X-API-Key` header. */
const extractApiKey = (req: Request): string | undefined => {
  const authHeader = req.header("authorization");
  if (authHeader) {
    const [scheme, value] = authHeader.split(" ");
    if (scheme?.toLowerCase() === "bearer" && value) return value.trim();
    // Tolerate a bare key in the Authorization header.
    if (!value && scheme) return scheme.trim();
  }
  const apiKeyHeader = req.header("x-api-key");
  return apiKeyHeader?.trim() || undefined;
};
