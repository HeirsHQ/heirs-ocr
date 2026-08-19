import { randomBytes } from "crypto";

import { logger } from "../observability/logger";
import { getRedis } from "../redis";

/**
 * The Redis session mechanics shared by the admin console and the tenant portal.
 *
 * Both surfaces mint an opaque random handle, store the identity under it with a
 * TTL, and carry the handle in an httpOnly cookie — the only differences are the key
 * prefix, the lifetime, and how the stored identity is re-validated on read. Those
 * three become parameters here so the two session modules stay genuinely identical
 * in behaviour instead of drifting as features land on one and not the other.
 *
 * Beyond create/resolve/destroy this owns the **per-user index**. A session key is
 * looked up by token, which answers "who is this?" but not "where else is this
 * account signed in?" — and the latter is exactly what a security page needs. Each
 * user therefore gets a Redis set of their live tokens, maintained alongside the
 * session keys. Scanning `session:*` instead would be O(all sessions) on a shared
 * Redis, which is not something a page render should do.
 */

/** Metadata captured at sign-in so a session list means something to a human. */
export type SessionContext = {
  /** Source address, as the request reported it. */
  ip?: string;
  /** Raw user-agent; the portal renders a shortened form. */
  userAgent?: string;
};

/** What is stored under the session key: caller-defined identity plus provenance. */
type StoredSession<T> = T & { createdAt: number } & SessionContext;

/** One live session, as the security page lists it. Never includes the token. */
export type SessionView = {
  /** Stable, non-secret handle for this session — a hash prefix, not the token. */
  id: string;
  createdAt: number;
  ip?: string;
  userAgent?: string;
  /** True for the session making the request, which the UI marks and never revokes. */
  current: boolean;
};

/**
 * A token is a bearer credential, so it must not be handed back to the browser in a
 * list. The id is a short prefix of the token, which is enough to tell two rows
 * apart and useless for authenticating.
 */
const sessionId = (token: string): string => token.slice(0, 8);

export type SessionStore<T> = {
  create(userId: string, identity: T, ctx?: SessionContext): Promise<{ token: string; ttl: number }>;
  resolve(token: string): Promise<T | undefined>;
  destroy(token: string): Promise<void>;
  list(userId: string, currentToken?: string): Promise<SessionView[]>;
  /** Revokes every session for the user except `keepToken`. Returns how many went. */
  revokeOthers(userId: string, keepToken?: string): Promise<number>;
};

/**
 * Builds a session store.
 *
 * `revalidate` re-reads the underlying account on every resolve, so disabling or
 * deleting it takes effect on the next request rather than at TTL expiry — and it
 * returns the *fresh* identity, so a role change is picked up too. Returning
 * `undefined` means "this session is no longer valid".
 */
export const createSessionStore = <T extends { userId: string }>(opts: {
  /** Key prefix, e.g. `admin_session:`. The user index derives from it. */
  prefix: string;
  ttlSeconds: () => number;
  revalidate: (userId: string, stored: T) => Promise<T | undefined>;
}): SessionStore<T> => {
  const sessionKey = (token: string): string => `${opts.prefix}${token}`;
  // Distinct namespace from the session keys themselves so a prefix scan of one
  // never picks up the other.
  const indexKey = (userId: string): string => `${opts.prefix}index:${userId}`;

  /** Best-effort index maintenance — never fail a login because the index moved. */
  const indexAdd = async (userId: string, token: string, ttl: number): Promise<void> => {
    try {
      const redis = getRedis();
      await redis.sadd(indexKey(userId), token);
      // Re-asserted on every sign-in so the index outlives the newest session in it.
      await redis.expire(indexKey(userId), ttl);
    } catch (err) {
      logger.warn("session index add failed", { err: err instanceof Error ? err.message : String(err) });
    }
  };

  const indexRemove = async (userId: string, tokens: string[]): Promise<void> => {
    if (tokens.length === 0) return;
    try {
      await getRedis().srem(indexKey(userId), ...tokens);
    } catch (err) {
      logger.warn("session index remove failed", { err: err instanceof Error ? err.message : String(err) });
    }
  };

  const readStored = async (token: string): Promise<StoredSession<T> | undefined> => {
    const raw = await getRedis().get(sessionKey(token));
    return raw ? (JSON.parse(raw) as StoredSession<T>) : undefined;
  };

  return {
    async create(userId, identity, ctx = {}) {
      const token = randomBytes(32).toString("base64url");
      const ttl = opts.ttlSeconds();
      const stored: StoredSession<T> = { ...identity, createdAt: Date.now(), ip: ctx.ip, userAgent: ctx.userAgent };

      await getRedis().set(sessionKey(token), JSON.stringify(stored), "EX", ttl);
      await indexAdd(userId, token, ttl);
      return { token, ttl };
    },

    async resolve(token) {
      const stored = await readStored(token);
      if (!stored) return undefined;

      const { createdAt: _createdAt, ip: _ip, userAgent: _userAgent, ...identity } = stored;
      return opts.revalidate(identity.userId, identity as unknown as T);
    },

    async destroy(token) {
      // Read before deleting so the index entry can be cleared too; without the
      // userId there is no way to find which set the token belongs to.
      const stored = await readStored(token);
      await getRedis().del(sessionKey(token));
      if (stored) await indexRemove(stored.userId, [token]);
    },

    async list(userId, currentToken) {
      let tokens: string[] = [];
      try {
        tokens = await getRedis().smembers(indexKey(userId));
      } catch (err) {
        logger.warn("session list unavailable", { err: err instanceof Error ? err.message : String(err) });
        return [];
      }

      const sessions: SessionView[] = [];
      const expired: string[] = [];
      for (const token of tokens) {
        const stored = await readStored(token);
        if (!stored) {
          // The session key expired but its index entry outlived it; drop it so the
          // set does not accumulate tombstones.
          expired.push(token);
          continue;
        }
        sessions.push({
          id: sessionId(token),
          createdAt: stored.createdAt,
          ip: stored.ip,
          userAgent: stored.userAgent,
          current: token === currentToken,
        });
      }
      await indexRemove(userId, expired);

      // Newest first, but the caller's own session leads regardless — it is the one
      // they need to recognise before revoking anything else.
      return sessions.sort((a, b) => Number(b.current) - Number(a.current) || b.createdAt - a.createdAt);
    },

    async revokeOthers(userId, keepToken) {
      let tokens: string[] = [];
      try {
        tokens = await getRedis().smembers(indexKey(userId));
      } catch (err) {
        logger.warn("session revoke unavailable", { err: err instanceof Error ? err.message : String(err) });
        return 0;
      }

      const doomed = tokens.filter((t) => t !== keepToken);
      if (doomed.length === 0) return 0;

      await getRedis().del(...doomed.map(sessionKey));
      await indexRemove(userId, doomed);
      logger.info("sessions revoked", { userId, count: doomed.length });
      return doomed.length;
    },
  };
};
