import { randomBytes } from "crypto";

import type { TenantRole } from "../types/user";
import { getTenantUserById } from "./tenant-users";
import { env } from "../config/env";
import { getRedis } from "../redis";

/**
 * Redis-backed tenant-portal sessions — the tenant-side twin of the admin sessions
 * (src/auth/admin-session.ts). Login mints an opaque high-entropy token stored
 * under `tenant_session:<token>` with a TTL, carried to the browser in an httpOnly
 * cookie. The token is a random handle (not a JWT), so logout/revocation is a
 * single `DEL`.
 *
 * On resolve we re-check the user still exists and isn't disabled, and return the
 * fresh `tenantId`/`role`, so disabling an account (or a role change) takes effect
 * on its next request, not only at TTL expiry.
 */
const SESSION_PREFIX = "tenant_session:";

/** Cookie name carrying the session token. */
export const SESSION_COOKIE = "tenant_session";

/** The resolved tenant-user identity attached to a request by the tenant-auth middleware. */
export type TenantSession = { userId: string; tenantId: string; role: TenantRole };

const sessionKey = (token: string): string => `${SESSION_PREFIX}${token}`;

/** Creates a session for a tenant user, returning the token and its TTL (seconds). */
export const createSession = async (
  userId: string,
  tenantId: string,
  role: TenantRole,
): Promise<{ token: string; ttl: number }> => {
  const token = randomBytes(32).toString("base64url");
  const ttl = env.TENANT_SESSION_TTL_SECONDS;
  await getRedis().set(sessionKey(token), JSON.stringify({ userId, tenantId, role }), "EX", ttl);
  return { token, ttl };
};

/**
 * Resolves a session token to the current caller, or `undefined` if the token is
 * unknown/expired, or the underlying user was deleted or disabled. The stored
 * `tenantId`/`role` are re-read from the user record so they can't go stale.
 */
export const resolveSession = async (token: string): Promise<TenantSession | undefined> => {
  const raw = await getRedis().get(sessionKey(token));
  if (!raw) return undefined;

  const { userId } = JSON.parse(raw) as TenantSession;
  const user = await getTenantUserById(userId);
  if (!user || user.disabled) return undefined;
  return { userId, tenantId: user.tenantId, role: user.role };
};

/** Destroys a session (logout). Idempotent. */
export const destroySession = async (token: string): Promise<void> => {
  await getRedis().del(sessionKey(token));
};
