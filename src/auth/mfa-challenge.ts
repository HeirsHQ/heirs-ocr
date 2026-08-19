import { randomBytes } from "crypto";

import { getRedis } from "../redis";

/**
 * The half-finished login that sits between a correct password and a verified
 * second factor.
 *
 * When an MFA-enrolled user submits the right password, login does **not** mint a
 * session — it mints one of these instead and hands the browser an opaque handle.
 * `POST /api/login/mfa` trades that handle plus a valid code for the real session.
 * The distinction matters: if the password step returned a session cookie and the
 * MFA prompt were merely a screen in front of it, a stolen password would still be
 * a full compromise.
 *
 * Challenges live in Redis under their own prefix with a short TTL — long enough to
 * open an authenticator app, short enough that an abandoned one is not a standing
 * credential. They are single-use: consuming one deletes it, so a captured handle
 * can't be replayed even inside the window.
 *
 * The same store serves both surfaces; `scope` namespaces them exactly as the login
 * throttle does (src/auth/login-throttle.ts), so an admin handle can never be
 * redeemed against the tenant portal.
 */

/** Seconds a pending challenge stays redeemable. */
export const CHALLENGE_TTL_SECONDS = 5 * 60;

const challengeKey = (scope: string, token: string): string => `mfa_challenge:${scope}:${token}`;

/** What the second-factor step needs to know about the user who passed the first. */
export type MfaChallenge = {
  userId: string;
  /** Carried so the throttle and the audit log can name the account without a re-read. */
  email: string;
};

/** Mints a single-use challenge for a user who has cleared the password step. */
export const createChallenge = async (scope: string, challenge: MfaChallenge): Promise<string> => {
  const token = randomBytes(32).toString("base64url");
  await getRedis().set(challengeKey(scope, token), JSON.stringify(challenge), "EX", CHALLENGE_TTL_SECONDS);
  return token;
};

/**
 * Reads a challenge without spending it. Used to identify the account before the
 * code is checked — a wrong code must leave the challenge usable, or a typo would
 * force the user back through the password step.
 */
export const peekChallenge = async (scope: string, token: string): Promise<MfaChallenge | undefined> => {
  const raw = await getRedis().get(challengeKey(scope, token));
  return raw ? (JSON.parse(raw) as MfaChallenge) : undefined;
};

/** Spends a challenge. Called only once the code has verified. Idempotent. */
export const consumeChallenge = async (scope: string, token: string): Promise<void> => {
  await getRedis().del(challengeKey(scope, token));
};
