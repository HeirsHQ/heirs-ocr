import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Second-factor coverage: the RFC 6238 primitive (src/auth/totp.ts), the durable
 * enrolment/verification store (src/auth/mfa.ts) against pg-mem, and the pending-
 * login challenge handles (src/auth/mfa-challenge.ts) against a fake Redis.
 *
 * The MFA columns are declared here rather than imported from `ensureSchema`
 * because pg-mem is seeded with plain DDL — same convention as test/admin.test.ts.
 */
const { query, resetDb, fakeRedis, strings } = vi.hoisted(() => {
  const { newDb } = require("pg-mem") as typeof import("pg-mem");

  const DDL = `
    CREATE TABLE IF NOT EXISTS admins (
      id uuid PRIMARY KEY,
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      role text NOT NULL,
      password_hash text NOT NULL,
      disabled boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      mfa_secret text,
      mfa_enabled boolean NOT NULL DEFAULT false,
      mfa_last_counter bigint,
      mfa_recovery_codes jsonb
    );
    CREATE TABLE IF NOT EXISTS tenant_users (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL,
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      role text NOT NULL,
      password_hash text NOT NULL,
      disabled boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      mfa_secret text,
      mfa_enabled boolean NOT NULL DEFAULT false,
      mfa_last_counter bigint,
      mfa_recovery_codes jsonb
    );
  `;

  let mem = newDb();
  let pool = new (mem.adapters.createPg().Pool)();

  const query = vi.fn((text: string, params?: unknown[]) => pool.query(text, params));
  const resetDb = async () => {
    mem = newDb();
    pool = new (mem.adapters.createPg().Pool)();
    mem.public.none(DDL);
    query.mockReset();
    query.mockImplementation((text: string, params?: unknown[]) => pool.query(text, params));
  };

  const strings = new Map<string, string>();
  const fakeRedis = {
    get: vi.fn(async (key: string) => strings.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      strings.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (strings.delete(key) ? 1 : 0)),
    ping: vi.fn(async () => "PONG"),
  };

  return { query, resetDb, fakeRedis, strings };
});

vi.mock("../src/db", () => ({
  query,
  ensureSchema: async () => {},
  whenDbReady: async () => {},
  closeDb: async () => {},
}));
vi.mock("../src/redis", () => ({ getRedis: () => fakeRedis, whenRedisReady: async () => {} }));

import {
  base32Decode,
  base32Encode,
  codeForCounter,
  counterFor,
  currentCode,
  generateSecret,
  otpauthUri,
  verifyCode,
} from "../src/auth/totp";
import {
  beginEnrolment,
  confirmEnrolment,
  disableMfa,
  getMfaStatus,
  isMfaEnabled,
  MfaAlreadyEnabledError,
  regenerateRecoveryCodes,
  verifyMfa,
} from "../src/auth/mfa";
import { consumeChallenge, createChallenge, peekChallenge } from "../src/auth/mfa-challenge";
import { createTenantUser } from "../src/auth/tenant-users";
import { createAdmin } from "../src/auth/admins";

const reset = async () => {
  await resetDb();
  strings.clear();
};

// ── TOTP primitive ────────────────────────────────────────────────────────────

describe("totp", () => {
  it("base32 round-trips, and decoding tolerates spaces/padding/lower case", () => {
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11]);
    const encoded = base32Encode(buf);
    expect(base32Decode(encoded).equals(buf)).toBe(true);
    expect(base32Decode(encoded.toLowerCase().replace(/(.{4})/g, "$1 ") + "==").equals(buf)).toBe(true);
  });

  it("matches the RFC 4226 test vector", () => {
    // RFC 4226 Appendix D: secret "12345678901234567890" (ASCII), counter 0 → 755224.
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(codeForCounter(secret, 0)).toBe("755224");
    expect(codeForCounter(secret, 1)).toBe("287082");
    expect(codeForCounter(secret, 9)).toBe("520489");
  });

  it("generates a 6-digit code and verifies it inside the skew window", () => {
    const secret = generateSecret();
    const at = new Date("2026-08-18T12:00:00Z");
    const code = currentCode(secret, at);
    expect(code).toMatch(/^\d{6}$/);

    expect(verifyCode(secret, code, { at }).ok).toBe(true);
    // ±1 step of clock skew still verifies; 2 steps out does not.
    expect(verifyCode(secret, code, { at: new Date(at.getTime() + 30_000) }).ok).toBe(true);
    expect(verifyCode(secret, code, { at: new Date(at.getTime() - 30_000) }).ok).toBe(true);
    expect(verifyCode(secret, code, { at: new Date(at.getTime() + 90_000) }).ok).toBe(false);
  });

  it("rejects malformed input and a code from a different secret", () => {
    const secret = generateSecret();
    const at = new Date("2026-08-18T12:00:00Z");
    expect(verifyCode(secret, "12345", { at }).ok).toBe(false);
    expect(verifyCode(secret, "abcdef", { at }).ok).toBe(false);
    expect(verifyCode(secret, "", { at }).ok).toBe(false);
    expect(verifyCode(secret, currentCode(generateSecret(), at), { at }).ok).toBe(false);
  });

  it("notBefore rejects a counter already consumed", () => {
    const secret = generateSecret();
    const at = new Date("2026-08-18T12:00:00Z");
    const counter = counterFor(at);
    const code = currentCode(secret, at);

    expect(verifyCode(secret, code, { at, notBefore: counter - 1 }).ok).toBe(true);
    expect(verifyCode(secret, code, { at, notBefore: counter }).ok).toBe(false);
  });

  it("builds an otpauth URI carrying the issuer in both the label and the query", () => {
    const uri = otpauthUri({ secret: "ABCDEFGH", account: "a@x.com", issuer: "Heirs OCR" });
    expect(uri.startsWith("otpauth://totp/Heirs%20OCR%3Aa%40x.com?")).toBe(true);
    expect(uri).toContain("issuer=Heirs+OCR");
    expect(uri).toContain("secret=ABCDEFGH");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});

// ── Enrolment + verification store ────────────────────────────────────────────

const seedAdmin = async () => createAdmin({ email: "a@x.com", name: "A", role: "owner", password: "secret12345" });

describe("mfa enrolment", () => {
  beforeEach(reset);

  it("starts disabled, and beginEnrolment leaves it pending until confirmed", async () => {
    const admin = await seedAdmin();
    expect(await getMfaStatus("admins", admin.id)).toEqual({
      enabled: false,
      pending: false,
      recoveryCodesRemaining: 0,
    });

    const { secret, otpauthUri: uri } = await beginEnrolment("admins", admin.id, admin.email);
    expect(uri).toContain(`secret=${secret}`);
    // The secret exists but the factor is not live yet — a user whose authenticator
    // never received it must still be able to log in.
    expect(await getMfaStatus("admins", admin.id)).toEqual({
      enabled: false,
      pending: true,
      recoveryCodesRemaining: 0,
    });
    expect(await isMfaEnabled("admins", admin.id)).toBe(false);
  });

  it("confirmEnrolment enables the factor and returns one-time recovery codes", async () => {
    const admin = await seedAdmin();
    const { secret } = await beginEnrolment("admins", admin.id, admin.email);

    expect(await confirmEnrolment("admins", admin.id, "000000")).toEqual({ ok: false });
    expect(await isMfaEnabled("admins", admin.id)).toBe(false);

    const result = await confirmEnrolment("admins", admin.id, currentCode(secret));
    expect(result.ok).toBe(true);
    const codes = (result as { ok: true; recoveryCodes: string[] }).recoveryCodes;
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

    expect(await getMfaStatus("admins", admin.id)).toEqual({
      enabled: true,
      pending: false,
      recoveryCodesRemaining: 10,
    });
  });

  it("never stores a recovery code in plaintext", async () => {
    const admin = await seedAdmin();
    const { secret } = await beginEnrolment("admins", admin.id, admin.email);
    const result = await confirmEnrolment("admins", admin.id, currentCode(secret));
    const codes = (result as { ok: true; recoveryCodes: string[] }).recoveryCodes;

    const { rows } = await query(`SELECT mfa_recovery_codes FROM admins WHERE id = $1`, [admin.id]);
    const stored = (rows[0] as { mfa_recovery_codes: string[] }).mfa_recovery_codes;
    expect(stored).toHaveLength(10);
    for (const hash of stored) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    for (const code of codes) expect(stored).not.toContain(code);
  });

  it("refuses to re-enrol an account that already has a confirmed factor", async () => {
    const admin = await seedAdmin();
    const { secret } = await beginEnrolment("admins", admin.id, admin.email);
    await confirmEnrolment("admins", admin.id, currentCode(secret));

    // Silently rotating a working secret would lock the user out.
    await expect(beginEnrolment("admins", admin.id, admin.email)).rejects.toThrow(MfaAlreadyEnabledError);
  });

  it("re-running beginEnrolment replaces an abandoned pending secret", async () => {
    const admin = await seedAdmin();
    const first = await beginEnrolment("admins", admin.id, admin.email);
    const second = await beginEnrolment("admins", admin.id, admin.email);
    expect(second.secret).not.toBe(first.secret);

    // Only the newest secret confirms.
    expect(await confirmEnrolment("admins", admin.id, currentCode(first.secret))).toEqual({ ok: false });
    expect((await confirmEnrolment("admins", admin.id, currentCode(second.secret))).ok).toBe(true);
  });
});

describe("mfa verification", () => {
  beforeEach(reset);

  /**
   * Confirms with a code from one step back (still inside the skew window). The
   * confirming code is consumed by the replay guard, so an account enrolled with
   * the *current* code cannot immediately log in with that same code — pinned
   * explicitly below. Backing off a step leaves the current one usable here.
   */
  const enrol = async () => {
    const admin = await seedAdmin();
    const { secret } = await beginEnrolment("admins", admin.id, admin.email);
    const result = await confirmEnrolment("admins", admin.id, currentCode(secret, new Date(Date.now() - 30_000)));
    return { admin, secret, recoveryCodes: (result as { ok: true; recoveryCodes: string[] }).recoveryCodes };
  };

  it("does not let the code that confirmed enrolment double as a login code", async () => {
    const admin = await seedAdmin();
    const { secret } = await beginEnrolment("admins", admin.id, admin.email);
    const code = currentCode(secret);
    expect((await confirmEnrolment("admins", admin.id, code)).ok).toBe(true);
    // Its counter is already spent; the user waits for the next 30-second step.
    expect(await verifyMfa("admins", admin.id, code)).toBeUndefined();
  });

  it("accepts the current TOTP code and rejects a wrong one", async () => {
    const { admin, secret } = await enrol();
    expect(await verifyMfa("admins", admin.id, "000000")).toBeUndefined();
    expect(await verifyMfa("admins", admin.id, currentCode(secret))).toBe("totp");
  });

  it("refuses a code that was already spent (replay inside the 30s window)", async () => {
    const { admin, secret } = await enrol();
    const code = currentCode(secret);
    expect(await verifyMfa("admins", admin.id, code)).toBe("totp");
    // Without the persisted counter, a code observed in transit stays usable until
    // its step rolls over.
    expect(await verifyMfa("admins", admin.id, code)).toBeUndefined();
  });

  it("accepts a recovery code exactly once, and normalizes how it was typed", async () => {
    const { admin, recoveryCodes } = await enrol();
    const code = recoveryCodes[0]!;

    expect(await verifyMfa("admins", admin.id, code.toLowerCase().replace("-", " "))).toBe("recovery");
    expect((await getMfaStatus("admins", admin.id))!.recoveryCodesRemaining).toBe(9);
    expect(await verifyMfa("admins", admin.id, code)).toBeUndefined();

    // The rest of the set is untouched.
    expect(await verifyMfa("admins", admin.id, recoveryCodes[1]!)).toBe("recovery");
    expect((await getMfaStatus("admins", admin.id))!.recoveryCodesRemaining).toBe(8);
  });

  it("verifies nothing for an account that is not enrolled", async () => {
    const admin = await seedAdmin();
    const { secret } = await beginEnrolment("admins", admin.id, admin.email);
    // Pending, not confirmed — the factor is not live, so it cannot gate a login.
    expect(await verifyMfa("admins", admin.id, currentCode(secret))).toBeUndefined();
  });

  it("disableMfa clears the secret, the counter, and the recovery codes", async () => {
    const { admin, secret, recoveryCodes } = await enrol();
    await disableMfa("admins", admin.id);

    expect(await isMfaEnabled("admins", admin.id)).toBe(false);
    expect(await verifyMfa("admins", admin.id, currentCode(secret))).toBeUndefined();
    expect(await verifyMfa("admins", admin.id, recoveryCodes[0]!)).toBeUndefined();

    const { rows } = await query(`SELECT mfa_secret, mfa_recovery_codes FROM admins WHERE id = $1`, [admin.id]);
    expect(rows[0]).toMatchObject({ mfa_secret: null, mfa_recovery_codes: null });
  });

  it("regenerateRecoveryCodes invalidates the old set, and no-ops when not enrolled", async () => {
    const { admin, recoveryCodes } = await enrol();
    const next = await regenerateRecoveryCodes("admins", admin.id);
    expect(next).toHaveLength(10);
    expect(await verifyMfa("admins", admin.id, recoveryCodes[0]!)).toBeUndefined();
    expect(await verifyMfa("admins", admin.id, next![0]!)).toBe("recovery");

    const plain = await createAdmin({ email: "b@x.com", name: "B", role: "viewer", password: "secret12345" });
    expect(await regenerateRecoveryCodes("admins", plain.id)).toBeUndefined();
  });

  it("an operator reset clears the factor, so a lost device is not a permanent lockout", async () => {
    const { admin, secret, recoveryCodes } = await enrol();

    // What DELETE /api/admins/:id/mfa does — the actor is another owner, not self.
    await disableMfa("admins", admin.id, "some-other-owner");

    expect(await isMfaEnabled("admins", admin.id)).toBe(false);
    expect(await verifyMfa("admins", admin.id, currentCode(secret))).toBeUndefined();
    expect(await verifyMfa("admins", admin.id, recoveryCodes[0]!)).toBeUndefined();
    // The account is back to a clean slate and can enrol again.
    await expect(beginEnrolment("admins", admin.id, admin.email)).resolves.toHaveProperty("secret");
  });

  it("works identically against the tenant_users table", async () => {
    const user = await createTenantUser({
      tenantId: "acme",
      email: "t@x.com",
      name: "T",
      role: "owner",
      password: "secret12345",
    });

    const { secret } = await beginEnrolment("tenant_users", user.id, user.email);
    const confirmCode = currentCode(secret, new Date(Date.now() - 30_000));
    expect((await confirmEnrolment("tenant_users", user.id, confirmCode)).ok).toBe(true);
    expect(await isMfaEnabled("tenant_users", user.id)).toBe(true);
    expect(await verifyMfa("tenant_users", user.id, currentCode(secret))).toBe("totp");
  });
});

// ── Pending-login challenges ──────────────────────────────────────────────────

describe("mfa challenges", () => {
  beforeEach(reset);

  it("peek reads without spending, consume spends for good", async () => {
    const token = await createChallenge("admin", { userId: "u1", email: "a@x.com" });
    expect(await peekChallenge("admin", token)).toEqual({ userId: "u1", email: "a@x.com" });
    // A wrong code must leave the challenge usable — a typo shouldn't restart login.
    expect(await peekChallenge("admin", token)).toEqual({ userId: "u1", email: "a@x.com" });

    await consumeChallenge("admin", token);
    expect(await peekChallenge("admin", token)).toBeUndefined();
  });

  it("is stored with a TTL, so an abandoned login is not a standing credential", async () => {
    await createChallenge("admin", { userId: "u1", email: "a@x.com" });
    expect(fakeRedis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), "EX", 5 * 60);
  });

  it("namespaces by scope, so an admin handle cannot be redeemed on the tenant portal", async () => {
    const token = await createChallenge("admin", { userId: "u1", email: "a@x.com" });
    expect(await peekChallenge("tenant", token)).toBeUndefined();
    expect(await peekChallenge("admin", token)).toBeDefined();
  });

  it("returns undefined for an unknown handle", async () => {
    expect(await peekChallenge("admin", "nope")).toBeUndefined();
  });
});
