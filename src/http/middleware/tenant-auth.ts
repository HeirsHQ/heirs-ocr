import type { NextFunction, Request, Response } from "express";

import { SESSION_COOKIE, resolveSession } from "../../auth/tenant-session";
import type { TenantRole } from "../../types/user";
import { parseCookies } from "./admin-auth";

/**
 * Tenant-portal authentication + role-based authorization — the tenant-side twin of
 * {@link import("./admin-auth")}. The portal is a same-origin surface served under
 * `/tenant`; the browser holds an httpOnly session cookie (see
 * src/auth/tenant-session.ts) and every `/tenant/api/*` route except login runs
 * through {@link tenantAuth}, then a {@link requireTenantRole} guard.
 *
 * Same plain JSON error shape (`{ error: { code, message } }`) as the admin surface.
 */

/** Least → most privileged. A caller satisfies a guard when their rank ≥ the minimum. */
const ROLE_RANK: Record<TenantRole, number> = { member: 0, owner: 1 };

const deny = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ error: { code, message } });
};

/**
 * Resolves the session cookie to `req.tenantUser`, or rejects with 401. Fail-closed:
 * any missing/expired/revoked session is unauthorized.
 */
export const tenantAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) {
    deny(res, 401, "UNAUTHORIZED", "Not signed in");
    return;
  }

  try {
    const session = await resolveSession(token);
    if (!session) {
      deny(res, 401, "UNAUTHORIZED", "Session expired or invalid");
      return;
    }
    req.tenantUser = session;
    next();
  } catch {
    // Session store unreachable — fail closed (this is an access control).
    deny(res, 503, "PROVIDER_UNAVAILABLE", "Session store unavailable");
  }
};

/**
 * Guard factory: admits a caller whose role ranks at or above `min`. Assumes
 * {@link tenantAuth} ran first (so `req.tenantUser` is set); 403 otherwise.
 */
export const requireTenantRole =
  (min: TenantRole) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const role = req.tenantUser?.role;
    if (!role || ROLE_RANK[role] < ROLE_RANK[min]) {
      deny(res, 403, "FORBIDDEN", `Requires ${min} access`);
      return;
    }
    next();
  };
