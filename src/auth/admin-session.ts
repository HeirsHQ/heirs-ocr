import type { AdminRole } from "../types/user";
import { createSessionStore, type SessionContext, type SessionView } from "./session-store";
import { personLabel } from "../observability/audit-labels";
import { getAdminById } from "./admins";
import { env } from "../config/env";

/**
 * Redis-backed admin sessions for the console. Login mints an opaque high-entropy
 * token stored under `admin_session:<token>` with a TTL, carried to the browser in
 * an httpOnly cookie. Because the token is a random handle (not a JWT), logout /
 * revocation is a single `DEL` — there's no signed state to invalidate.
 *
 * On resolve we re-check the admin still exists and isn't disabled, so revoking or
 * disabling an account takes effect on its next request, not only at TTL expiry.
 */
/** The resolved caller identity attached to a request by the auth middleware. */
export type AdminSession = {
  userId: string;
  role: AdminRole;
  /**
   * Display name for the audit trail — `Ada Obi (ada@x.com)`.
   *
   * Carried on the session because resolving it costs nothing: the admin record is
   * already read on every request to re-check the account is live, so every audited
   * mutation gets a readable actor without a second query of its own.
   */
  label?: string;
};

const SESSION_PREFIX = "admin_session:";

/** Cookie name carrying the session token. */
export const SESSION_COOKIE = "admin_session";

/**
 * The shared Redis session mechanics (src/auth/session-store.ts), pinned to the
 * console's prefix and TTL. `revalidate` re-reads the admin on every request, so a
 * disabled or deleted account stops working immediately and a role change is picked
 * up rather than waiting for the token to expire.
 */
const store = createSessionStore<AdminSession>({
  prefix: SESSION_PREFIX,
  ttlSeconds: () => env.ADMIN_SESSION_TTL_SECONDS,
  revalidate: async (userId) => {
    const admin = await getAdminById(userId);
    if (!admin || admin.disabled) return undefined;
    return { userId, role: admin.role, label: personLabel(admin) };
  },
});

/** Creates a session for a user, returning the token and its TTL (seconds). */
export const createSession = async (
  userId: string,
  role: AdminRole,
  ctx?: SessionContext,
): Promise<{ token: string; ttl: number }> => store.create(userId, { userId, role }, ctx);

/**
 * Resolves a session token to the current caller, or `undefined` if the token is
 * unknown/expired, or the underlying admin was deleted or disabled (or its role
 * changed — the fresh role is returned).
 */
export const resolveSession = (token: string): Promise<AdminSession | undefined> => store.resolve(token);

/** Destroys a session (logout). Idempotent. */
export const destroySession = (token: string): Promise<void> => store.destroy(token);

/** Live sessions for one admin, for the console's security page. Never returns tokens. */
export const listSessions = (userId: string, currentToken?: string): Promise<SessionView[]> =>
  store.list(userId, currentToken);

/** Signs the admin out everywhere except the session making the request. */
export const revokeOtherSessions = (userId: string, keepToken?: string): Promise<number> =>
  store.revokeOthers(userId, keepToken);
