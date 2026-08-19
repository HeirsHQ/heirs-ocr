import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * RFC 6238 time-based one-time passwords, the second factor for both the admin
 * console and the tenant portal.
 *
 * Implemented directly on `node:crypto` rather than pulled from npm: the algorithm
 * is an HMAC, a counter, and a truncation, and a login-critical primitive is not
 * worth a supply-chain dependency. SHA-1 / 6 digits / 30-second steps are not
 * choices — they are what every authenticator app assumes when the `otpauth://`
 * URI omits the parameters, so deviating breaks enrolment with Google
 * Authenticator, 1Password, and the rest.
 */

/** Seconds per code. Fixed by what authenticator apps default to. */
export const STEP_SECONDS = 30;
/** Code length. Also fixed by the apps' default. */
const DIGITS = 6;
/**
 * How many steps either side of "now" still verify, absorbing clock skew between
 * the server and the user's phone. One step each way (±30s) is the usual setting:
 * wider makes a stolen code useful for longer.
 */
const SKEW_STEPS = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, unpadded — the encoding authenticator apps expect for a secret. */
export const base32Encode = (buf: Buffer): string => {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
};

/** Inverse of {@link base32Encode}. Tolerates padding, spaces, and lower case — all
 *  of which users introduce when they type a secret in by hand. */
export const base32Decode = (input: string): Buffer => {
  const clean = input.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("Invalid base32 character in TOTP secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

/** A fresh 160-bit secret, base32-encoded — the size RFC 4226 recommends for SHA-1. */
export const generateSecret = (): string => base32Encode(randomBytes(20));

/** The time step a given moment falls in. Exported so callers can pin replay state. */
export const counterFor = (at: Date = new Date()): number => Math.floor(at.getTime() / 1000 / STEP_SECONDS);

/** The code for one specific counter value. */
export const codeForCounter = (secret: string, counter: number): string => {
  const buf = Buffer.alloc(8);
  // Counters stay well inside 2^53, so a BigInt write is unnecessary; write the low
  // 32 bits and the high 32 bits separately to keep this to plain integer maths.
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  // Dynamic truncation (RFC 4226 §5.3): the low nibble of the last byte picks the
  // 4-byte window, whose top bit is masked off so the result is always positive.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
};

/** The code valid right now. Used by tests and by nothing on the request path. */
export const currentCode = (secret: string, at: Date = new Date()): string => codeForCounter(secret, counterFor(at));

/** Length-safe constant-time compare — `timingSafeEqual` throws on a length mismatch. */
const constantTimeEquals = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

export type VerifyResult =
  /** The counter the code matched. Persist it: a code must not be accepted twice. */
  { ok: true; counter: number } | { ok: false };

/**
 * Verifies a submitted code against the secret, scanning the skew window.
 *
 * Returns the matched counter so the caller can store it and refuse anything at or
 * below it next time — without that, a code observed in transit stays replayable
 * for the rest of its 30-second life. Pass `notBefore` (the last counter this user
 * consumed) to enforce that.
 */
export const verifyCode = (
  secret: string,
  code: string,
  opts: { at?: Date; notBefore?: number } = {},
): VerifyResult => {
  const trimmed = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(trimmed)) return { ok: false };

  const now = counterFor(opts.at ?? new Date());
  for (let offset = -SKEW_STEPS; offset <= SKEW_STEPS; offset++) {
    const counter = now + offset;
    if (opts.notBefore !== undefined && counter <= opts.notBefore) continue;
    if (constantTimeEquals(codeForCounter(secret, counter), trimmed)) return { ok: true, counter };
  }
  return { ok: false };
};

/**
 * The `otpauth://` enrolment URI an authenticator app reads (from a QR code, or by
 * being handed the link directly on mobile).
 *
 * `issuer` is repeated in the label prefix as well as the query parameter — older
 * apps read only the prefix, newer ones only the parameter, and disagreeing leaves
 * the account labelled inconsistently across a user's devices.
 */
export const otpauthUri = (opts: { secret: string; account: string; issuer: string }): string => {
  const label = encodeURIComponent(`${opts.issuer}:${opts.account}`);
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
};
