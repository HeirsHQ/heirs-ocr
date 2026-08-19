import { createHash, randomInt, timingSafeEqual } from "crypto";

import { counterFor, generateSecret, otpauthUri, verifyCode } from "./totp";
import { logger } from "../observability/logger";
import { query } from "../db";
import { env } from "../config/env";

/**
 * Second-factor enrolment and verification for both login surfaces.
 *
 * The admin registry (src/auth/admins.ts) and the tenant-user registry
 * (src/auth/tenant-users.ts) carry an identical set of MFA columns, so the logic
 * lives here once and takes the table as a parameter. `MfaTable` is a literal
 * union rather than a string — the value is interpolated into the statement (a
 * table name can't be a bind parameter), so the type is what keeps that safe.
 *
 * Enrolment is two-phase on purpose: `beginEnrolment` stores the secret with
 * `mfa_enabled` still false, and only `confirmEnrolment` — which requires a code
 * derived from that secret — flips the flag. Storing an unconfirmed secret as
 * "enabled" would lock a user out of their own account if their authenticator
 * never actually received it.
 *
 * The TOTP primitive itself is in src/auth/totp.ts; this module owns persistence,
 * replay state, and the recovery codes.
 */

/** The two tables carrying MFA columns. Not a free-form string — see the note above. */
export type MfaTable = "admins" | "tenant_users";

/** How many single-use recovery codes are minted when enrolment is confirmed. */
const RECOVERY_CODE_COUNT = 10;
/** Characters used in a recovery code. Crockford-ish: no O/I/L/U to survive transcription. */
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
/** Characters per half of a `xxxxx-xxxxx` code. 10 chars of a 30-symbol alphabet ≈ 49 bits. */
const RECOVERY_HALF = 5;

/** What the API may reveal about a user's MFA state. Never includes the secret. */
export type MfaStatus = {
  enabled: boolean;
  /** True once a secret exists but the confirming code hasn't been supplied yet. */
  pending: boolean;
  /** Unused recovery codes left. Zero on an enrolled account is worth warning about. */
  recoveryCodesRemaining: number;
};

type MfaRow = {
  mfa_secret: string | null;
  mfa_enabled: boolean;
  mfa_last_counter: string | number | null;
  mfa_recovery_codes: string[] | null;
};

/**
 * Recovery codes are stored as sha256 hashes, not argon2. They are high-entropy
 * random tokens (≈49 bits, server-generated, never user-chosen), so there is no
 * dictionary to slow down — the same reasoning that makes sha256 right for API
 * keys (src/auth/tenants.ts). It also matters here that verification has to scan
 * the whole list: ten argon2 verifies per attempt would be a self-inflicted DoS.
 */
const hashRecoveryCode = (code: string): string =>
  createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");

/** Codes are shown grouped and typed back by hand — ignore case, spaces, and dashes. */
const normalizeRecoveryCode = (code: string): string => code.replace(/[\s-]/g, "").toUpperCase();

/** Length-safe constant-time compare (`timingSafeEqual` throws on a length mismatch). */
const constantTimeEquals = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

/** One `xxxxx-xxxxx` code drawn from the CSPRNG (`randomInt` is unbiased). */
const generateRecoveryCode = (): string => {
  let out = "";
  for (let i = 0; i < RECOVERY_HALF * 2; i++) {
    if (i === RECOVERY_HALF) out += "-";
    out += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  }
  return out;
};

const readRow = async (table: MfaTable, userId: string): Promise<MfaRow | undefined> => {
  const { rows } = await query<MfaRow>(
    `SELECT mfa_secret, mfa_enabled, mfa_last_counter, mfa_recovery_codes FROM ${table} WHERE id = $1`,
    [userId],
  );
  return rows[0];
};

/** Public MFA state for a user, or `undefined` if there is no such user. */
export const getMfaStatus = async (table: MfaTable, userId: string): Promise<MfaStatus | undefined> => {
  const row = await readRow(table, userId);
  if (!row) return undefined;
  return {
    enabled: row.mfa_enabled,
    pending: !row.mfa_enabled && !!row.mfa_secret,
    recoveryCodesRemaining: row.mfa_recovery_codes?.length ?? 0,
  };
};

/** Whether a second factor is required to finish this user's login. */
export const isMfaEnabled = async (table: MfaTable, userId: string): Promise<boolean> => {
  const row = await readRow(table, userId);
  return !!row?.mfa_enabled;
};

/**
 * Phase one of enrolment: mints a fresh secret, stores it **unconfirmed**, and
 * returns it with the `otpauth://` URI the authenticator app consumes.
 *
 * Calling this on an account mid-enrolment replaces the pending secret, which is
 * what a user who abandoned a half-finished setup expects. Calling it on an
 * already-enrolled account is refused: silently rotating a working secret would
 * lock the user out the moment they closed the page.
 */
export const beginEnrolment = async (
  table: MfaTable,
  userId: string,
  account: string,
): Promise<{ secret: string; otpauthUri: string }> => {
  const row = await readRow(table, userId);
  if (!row) throw new Error("No such user");
  if (row.mfa_enabled) throw new MfaAlreadyEnabledError();

  const secret = generateSecret();
  await query(`UPDATE ${table} SET mfa_secret = $2, mfa_enabled = false, mfa_last_counter = NULL WHERE id = $1`, [
    userId,
    secret,
  ]);
  logger.info("mfa.enrolment.started", { table, userId });

  return { secret, otpauthUri: otpauthUri({ secret, account, issuer: env.MFA_ISSUER }) };
};

/** Thrown by {@link beginEnrolment} when the account already has a confirmed factor. */
export class MfaAlreadyEnabledError extends Error {
  constructor() {
    super("Two-factor authentication is already enabled");
    this.name = "MfaAlreadyEnabledError";
  }
}

/**
 * Phase two: verifies a code against the pending secret and, on success, enables
 * MFA and mints the recovery codes.
 *
 * The plaintext codes are returned **once** — only their hashes are stored, so
 * this response is the user's only chance to keep them.
 */
export const confirmEnrolment = async (
  table: MfaTable,
  userId: string,
  code: string,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false }> => {
  const row = await readRow(table, userId);
  if (!row?.mfa_secret || row.mfa_enabled) return { ok: false };

  const result = verifyCode(row.mfa_secret, code);
  if (!result.ok) return { ok: false };

  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  await query(`UPDATE ${table} SET mfa_enabled = true, mfa_last_counter = $2, mfa_recovery_codes = $3 WHERE id = $1`, [
    userId,
    result.counter,
    JSON.stringify(recoveryCodes.map(hashRecoveryCode)),
  ]);
  logger.info("mfa.enabled", { table, userId });

  return { ok: true, recoveryCodes };
};

/**
 * Turns MFA off and clears every trace of it — secret, replay counter, and
 * recovery codes. Idempotent; safe on an account that never enrolled.
 *
 * Callers must re-authenticate the user (password) first: this endpoint removes a
 * security control, so a hijacked session must not be enough to reach it.
 */
export const disableMfa = async (table: MfaTable, userId: string, actor = "self"): Promise<void> => {
  await query(
    `UPDATE ${table} SET mfa_enabled = false, mfa_secret = NULL, mfa_last_counter = NULL,
       mfa_recovery_codes = NULL
     WHERE id = $1`,
    [userId],
  );
  logger.info("mfa.disabled", { table, userId, actor });
};

/** Re-mints the recovery codes for an enrolled account, invalidating the old set. */
export const regenerateRecoveryCodes = async (table: MfaTable, userId: string): Promise<string[] | undefined> => {
  const row = await readRow(table, userId);
  if (!row?.mfa_enabled) return undefined;

  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  await query(`UPDATE ${table} SET mfa_recovery_codes = $2 WHERE id = $1`, [
    userId,
    JSON.stringify(recoveryCodes.map(hashRecoveryCode)),
  ]);
  logger.info("mfa.recovery_codes.regenerated", { table, userId });
  return recoveryCodes;
};

/** How a successful second factor was satisfied — the login log records which. */
export type MfaFactor = "totp" | "recovery";

/**
 * Verifies a submitted second factor, trying the TOTP code first and falling back
 * to the recovery-code list.
 *
 * Two pieces of state move on success:
 *
 *  - **TOTP**: `mfa_last_counter` advances to the matched step, and the next
 *    verification passes it as `notBefore`. Without that, a code observed in
 *    transit stays usable for the rest of its 30-second window.
 *  - **Recovery**: the matched hash is deleted from the list. Each code works once.
 *
 * Returns `undefined` when the factor is wrong, so the caller can log the failure
 * and count it against the login throttle.
 */
export const verifyMfa = async (table: MfaTable, userId: string, code: string): Promise<MfaFactor | undefined> => {
  const row = await readRow(table, userId);
  if (!row?.mfa_enabled || !row.mfa_secret) return undefined;

  const lastCounter = row.mfa_last_counter === null ? undefined : Number(row.mfa_last_counter);
  const totp = verifyCode(row.mfa_secret, code, { notBefore: lastCounter });
  if (totp.ok) {
    await query(`UPDATE ${table} SET mfa_last_counter = $2 WHERE id = $1`, [userId, totp.counter]);
    return "totp";
  }

  const stored = row.mfa_recovery_codes ?? [];
  const submitted = hashRecoveryCode(code);
  // Scan the whole list with a constant-time compare per entry: bailing on the
  // first match would leak the matched position through timing.
  let matched = false;
  const remaining = stored.filter((hash) => {
    if (!matched && constantTimeEquals(hash, submitted)) {
      matched = true;
      return false;
    }
    return true;
  });
  if (!matched) return undefined;

  await query(`UPDATE ${table} SET mfa_recovery_codes = $2 WHERE id = $1`, [userId, JSON.stringify(remaining)]);
  logger.warn("mfa.recovery_code.used", { table, userId, remaining: remaining.length });
  return "recovery";
};

/** Re-exported so callers pinning replay state in tests don't reach into totp.ts. */
export { counterFor };
