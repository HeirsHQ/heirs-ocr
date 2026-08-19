import { createSessionStore, type SessionContext, type SessionView } from "./session-store";
import { personLabel } from "../observability/audit-labels";
import { getTenantUserById } from "./tenant-users";
import type { TenantRole } from "../types/user";
import { env } from "../config/env";

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
export type TenantSession = {
  userId: string;
  tenantId: string;
  role: TenantRole;
  /** Display name for the audit trail; resolved free from the record read below. */
  label?: string;
};

/**
 * The shared Redis session mechanics (src/auth/session-store.ts), pinned to the
 * portal's prefix and TTL. `revalidate` re-reads the user on every request, so the
 * stored `tenantId`/`role` cannot go stale and a disabled account stops working
 * immediately rather than at TTL expiry.
 */
const store = createSessionStore<TenantSession>({
  prefix: SESSION_PREFIX,
  ttlSeconds: () => env.TENANT_SESSION_TTL_SECONDS,
  revalidate: async (userId) => {
    const user = await getTenantUserById(userId);
    if (!user || user.disabled) return undefined;
    return { userId, tenantId: user.tenantId, role: user.role, label: personLabel(user) };
  },
});

/** Creates a session for a tenant user, returning the token and its TTL (seconds). */
export const createSession = async (
  userId: string,
  tenantId: string,
  role: TenantRole,
  ctx?: SessionContext,
): Promise<{ token: string; ttl: number }> => store.create(userId, { userId, tenantId, role }, ctx);

/**
 * Resolves a session token to the current caller, or `undefined` if the token is
 * unknown/expired, or the underlying user was deleted or disabled.
 */
export const resolveSession = (token: string): Promise<TenantSession | undefined> => store.resolve(token);

/** Destroys a session (logout). Idempotent. */
export const destroySession = (token: string): Promise<void> => store.destroy(token);

/** Live sessions for one tenant user, for the portal's security page. Never returns tokens. */
export const listSessions = (userId: string, currentToken?: string): Promise<SessionView[]> =>
  store.list(userId, currentToken);

/** Signs the user out everywhere except the session making the request. */
export const revokeOtherSessions = (userId: string, keepToken?: string): Promise<number> =>
  store.revokeOthers(userId, keepToken);
