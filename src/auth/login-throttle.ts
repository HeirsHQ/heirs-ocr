import { logger } from "../observability/logger";
import { getRedis } from "../redis";

/**
 * Brute-force throttle for the login endpoints. Failed attempts are counted in
 * Redis per source IP and per email over a sliding fixed window; once either
 * counter crosses its threshold, further attempts are refused until the window
 * expires. A successful login clears both counters.
 *
 * The `scope` (e.g. `"admin"` / `"tenant"`) namespaces the buckets so the admin
 * console and the tenant portal throttle independently — a spray against one
 * surface can't lock out the other.
 *
 * Keeping two independent buckets stops both a single IP spraying many accounts
 * and a distributed spray against one account. **Fail-open** on a Redis outage —
 * consistent with the request rate limiter, the throttle must not become the
 * outage it exists to prevent (login itself already fails closed if the account
 * store is down).
 */
const WINDOW_SECONDS = 15 * 60;
/** Max failed attempts per window before lockout. Per-email is tighter than per-IP. */
const MAX_PER_EMAIL = 10;
const MAX_PER_IP = 30;

const emailKey = (scope: string, email: string): string => `login_fail:${scope}:email:${email.trim().toLowerCase()}`;
const ipKey = (scope: string, ip: string): string => `login_fail:${scope}:ip:${ip}`;

/**
 * True when the caller may attempt a login. Reads the current failure counts
 * without incrementing. On a Redis error, allows the attempt (fail-open).
 */
export const loginAllowed = async (scope: string, ip: string, email: string): Promise<boolean> => {
  try {
    const redis = getRedis();
    const [ipCount, emailCount] = await Promise.all([redis.get(ipKey(scope, ip)), redis.get(emailKey(scope, email))]);
    return Number(ipCount ?? 0) < MAX_PER_IP && Number(emailCount ?? 0) < MAX_PER_EMAIL;
  } catch (err) {
    logger.warn("login throttle unavailable — allowing attempt", {
      err: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
};

/** Records one failed attempt against both the IP and the email buckets. */
export const recordLoginFailure = async (scope: string, ip: string, email: string): Promise<void> => {
  try {
    await Promise.all([bump(ipKey(scope, ip)), bump(emailKey(scope, email))]);
  } catch (err) {
    logger.warn("login throttle: could not record failure", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
};

/** Clears both buckets after a successful login so a legit user isn't penalised. */
export const clearLoginFailures = async (scope: string, ip: string, email: string): Promise<void> => {
  try {
    await getRedis().del(ipKey(scope, ip), emailKey(scope, email));
  } catch {
    // Best-effort; the counters expire on their own.
  }
};

/** INCR the counter and (re)assert its TTL on the first hit of a window. */
const bump = async (key: string): Promise<void> => {
  const redis = getRedis();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, WINDOW_SECONDS);
};
