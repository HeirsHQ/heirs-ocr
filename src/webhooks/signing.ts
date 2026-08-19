import { createHmac, timingSafeEqual } from "crypto";

/**
 * Request signing for outbound webhooks.
 *
 * Scheme (the widely-copied Stripe shape, because receivers already have libraries
 * and habits for it):
 *
 *     X-Heirs-Signature: t=1700000000,v1=<hex hmac>
 *
 * The signed string is `${timestamp}.${body}`, HMAC-SHA256 with the endpoint secret.
 *
 * The timestamp is **inside** the signed material, not merely alongside it. Signing
 * the body alone would let anyone who captured one delivery replay it forever; with
 * the timestamp covered, a receiver can reject anything older than its tolerance and
 * an attacker cannot move the clock forward without invalidating the signature.
 */

/** Header carrying the signature. */
export const SIGNATURE_HEADER = "X-Heirs-Signature";

export const signPayload = (body: string, secret: string, timestampSeconds: number): string => {
  const mac = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
};

/**
 * Verifies a signature header. Exported for tests and for documenting the scheme —
 * this service signs rather than verifies, but a receiver implementing the other
 * side should be able to read exactly what it must do.
 *
 * `toleranceSeconds` bounds replay: a delivery older than this is refused even if
 * the MAC is valid.
 */
export const verifySignature = (
  body: string,
  header: string,
  secret: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): boolean => {
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  const parts = new Map(
    header.split(",").map((piece) => {
      const [k, v] = piece.split("=");
      return [k?.trim() ?? "", v?.trim() ?? ""];
    }),
  );

  const timestamp = Number(parts.get("t"));
  const provided = parts.get("v1");
  if (!Number.isFinite(timestamp) || !provided) return false;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  // Length check first: timingSafeEqual throws on a mismatch rather than returning.
  return a.length === b.length && timingSafeEqual(a, b);
};
