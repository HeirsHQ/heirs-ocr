import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The platform password policy.
 *
 * `passwordMinLength` sat in the security settings namespace and was enforced
 * nowhere — shown on the console's policy panel and ignored by every path that
 * actually set a password. These pin that it now binds, and that a settings outage
 * cannot turn it into a total password-change outage.
 */
const { query, resetDb } = vi.hoisted(() => {
  const { newDb } = require("pg-mem") as typeof import("pg-mem");
  const DDL = `
    CREATE TABLE IF NOT EXISTS platform_settings (
      namespace text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
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
  return { query, resetDb };
});

vi.mock("../src/db", () => ({
  query,
  ensureSchema: async () => {},
  whenDbReady: async () => {},
  closeDb: async () => {},
}));

import { assertPasswordPolicy, PasswordPolicyError } from "../src/auth/password-policy";
import { putSettings } from "../src/config/settings-store";

beforeEach(resetDb);

describe("password policy", () => {
  it("accepts a password at the default minimum", async () => {
    await expect(assertPasswordPolicy("abcd1234")).resolves.toBeUndefined();
  });

  it("rejects one below it, naming the requirement", async () => {
    await expect(assertPasswordPolicy("short")).rejects.toThrow(PasswordPolicyError);
    await expect(assertPasswordPolicy("short")).rejects.toThrow(/at least 8 characters/);
  });

  it("honours a raised minimum from the settings namespace", async () => {
    await putSettings("security", {
      enforceHttps: true,
      sessionIdleTimeoutMinutes: 60,
      passwordMinLength: 16,
      ipAllowlist: [],
    });

    await expect(assertPasswordPolicy("abcd1234")).rejects.toThrow(/at least 16 characters/);
    await expect(assertPasswordPolicy("abcd1234abcd1234")).resolves.toBeUndefined();
  });

  it("never drops below the hard floor, whatever the setting says", async () => {
    // The schema clamps at 8, but the helper enforces it independently so a row
    // written by any other route cannot weaken the policy.
    await query(`INSERT INTO platform_settings (namespace, data) VALUES ($1, $2::jsonb)`, [
      "security",
      JSON.stringify({ enforceHttps: true, sessionIdleTimeoutMinutes: 60, passwordMinLength: 2, ipAllowlist: [] }),
    ]);
    await expect(assertPasswordPolicy("abc")).rejects.toThrow(/at least 8 characters/);
  });

  it("bounds the maximum so a login is not made arbitrarily expensive", async () => {
    await expect(assertPasswordPolicy("x".repeat(500))).rejects.toThrow(/at most/);
  });

  it("falls back to the hard minimum when settings cannot be read", async () => {
    query.mockImplementationOnce(() => Promise.reject(new Error("db down")));
    // Refusing every password change because a settings read blipped would be the
    // worse outcome; the floor still applies.
    await expect(assertPasswordPolicy("abcd1234")).resolves.toBeUndefined();
  });

  it("still rejects a weak password when settings cannot be read", async () => {
    query.mockImplementationOnce(() => Promise.reject(new Error("db down")));
    await expect(assertPasswordPolicy("short")).rejects.toThrow(PasswordPolicyError);
  });
});
