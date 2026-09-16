import { createHash, randomBytes } from "crypto";

import { getRedis } from "../redis";

/**
 * Single-use password-reset links for tenant portal users.
 *
 * A reset link is a bearer credential: whoever holds it can set the account's
 * password. So it is treated like one:
 *
 *  - **High entropy, hashed at rest.** The token is 32 random bytes; Redis holds only
 *    its SHA-256. A fast hash is enough here — unlike a six-digit signup code there is
 *    nothing to brute-force offline — and it lets the token itself be the lookup key.
 *  - **Short-lived.** {@link RESET_TTL_SECONDS}, enforced by the key's TTL.
 *  - **Single-use, atomically.** Redemption is a `GETDEL`, so two concurrent submits
 *    of the same link cannot both succeed.
 *  - **One live link per account.** Requesting another replaces the previous one, so
 *    an old email sitting in an inbox stops working the moment a new one is sent.
 *
 * Requests are cooldown-limited per account ({@link RESET_COOLDOWN_SECONDS}) so the
 * forgot-password endpoint cannot be used to flood someone's inbox. The route answers
 * identically either way; see src/http/tenant/routes.ts.
 */

/** How long a link stays redeemable. */
export const RESET_TTL_SECONDS = 30 * 60;

/** Minimum gap between two reset emails for the same account. */
export const RESET_COOLDOWN_SECONDS = 60;

const tokenKey = (tokenHash: string): string => `password_reset:token:${tokenHash}`;
/** Per-user pointer to the live token, so issuing a new link can revoke the old one. */
const userKey = (userId: string): string => `password_reset:user:${userId}`;

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export type PasswordResetRecord = {
  userId: string;
  tenantId: string;
  email: string;
  createdAt: number;
};

type UserPointer = { tokenHash: string; sentAt: number };

export type StartResetResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; reason: "cooldown"; retryAfterSeconds: number };

/**
 * Issues a reset link for an account and returns the **plaintext** token for the
 * caller to email. Returned rather than sent from here, as in src/auth/signup.ts, so
 * this module stays free of transport concerns.
 */
export const startPasswordReset = async (user: {
  id: string;
  tenantId: string;
  email: string;
}): Promise<StartResetResult> => {
  const redis = getRedis();
  const now = Date.now();

  const rawPointer = await redis.get(userKey(user.id));
  const previous = rawPointer ? (JSON.parse(rawPointer) as UserPointer) : undefined;
  if (previous) {
    const elapsed = (now - previous.sentAt) / 1000;
    if (elapsed < RESET_COOLDOWN_SECONDS) {
      return { ok: false, reason: "cooldown", retryAfterSeconds: Math.ceil(RESET_COOLDOWN_SECONDS - elapsed) };
    }
    await redis.del(tokenKey(previous.tokenHash));
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const record: PasswordResetRecord = { userId: user.id, tenantId: user.tenantId, email: user.email, createdAt: now };
  const pointer: UserPointer = { tokenHash, sentAt: now };

  await redis.set(tokenKey(tokenHash), JSON.stringify(record), "EX", RESET_TTL_SECONDS);
  await redis.set(userKey(user.id), JSON.stringify(pointer), "EX", RESET_TTL_SECONDS);

  return { ok: true, token, expiresAt: new Date(now + RESET_TTL_SECONDS * 1000) };
};

/** Reads a link without spending it, so a form error doesn't burn it. `undefined` once expired or used. */
export const peekPasswordReset = async (token: string): Promise<PasswordResetRecord | undefined> => {
  const raw = await getRedis().get(tokenKey(hashToken(token)));
  return raw ? (JSON.parse(raw) as PasswordResetRecord) : undefined;
};

/**
 * Spends a link. Atomic: of two concurrent redemptions exactly one gets the record.
 * Also drops the per-user pointer, which re-opens the request cooldown.
 */
export const consumePasswordReset = async (token: string): Promise<PasswordResetRecord | undefined> => {
  const redis = getRedis();
  const raw = await redis.getdel(tokenKey(hashToken(token)));
  if (!raw) return undefined;
  const record = JSON.parse(raw) as PasswordResetRecord;
  await redis.del(userKey(record.userId));
  return record;
};

/** Revokes an issued link — used when its email could not be delivered. */
export const discardPasswordReset = async (token: string, userId: string): Promise<void> => {
  await getRedis().del(tokenKey(hashToken(token)), userKey(userId));
};
