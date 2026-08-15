import { describe, expect, it, vi } from "vitest";

/**
 * Two self-service escape hatches that let a tenant out from under admin-set
 * controls: minting an unscoped API key, and keeping portal access after the org's
 * keys were disabled.
 */

const { query, rows } = vi.hoisted(() => {
  const rows: Array<Record<string, unknown>> = [];
  const query = vi.fn(async () => ({ rows }));
  return { query, rows };
});

vi.mock("../src/db", () => ({
  query,
  ensureSchema: async () => {},
  whenDbReady: async () => {},
  closeDb: async () => {},
}));

import { inheritedScope } from "../src/http/tenant/routes";
import { hashApiKey, isTenantOrgDisabled, resolveTenant } from "../src/auth/tenants";
import type { Tenant } from "../src/auth/tenants";

const key = (over: Partial<Tenant> = {}): Tenant => ({ tenantId: "tenant_a", ...over });

describe("inheritedScope — a tenant-minted key cannot escalate", () => {
  it("stays unrestricted for an org with no keys yet", () => {
    expect(inheritedScope([])).toEqual({});
  });

  it("inherits the function scope of a restricted org", () => {
    const scope = inheritedScope([key({ allowedFunctions: ["RECEIPT_PARSING"] })]);
    expect(scope.allowedFunctions).toEqual(["RECEIPT_PARSING"]);
  });

  it("unions across several restricted keys rather than intersecting", () => {
    const scope = inheritedScope([
      key({ allowedFunctions: ["RECEIPT_PARSING"] }),
      key({ allowedFunctions: ["TEXT_EXTRACTION", "RECEIPT_PARSING"] }),
    ]);
    expect(new Set(scope.allowedFunctions)).toEqual(new Set(["RECEIPT_PARSING", "TEXT_EXTRACTION"]));
  });

  it("stays unrestricted when the org already holds an unrestricted key", () => {
    // Nothing to escalate — that key can already call everything.
    const scope = inheritedScope([key({ allowedFunctions: ["RECEIPT_PARSING"] }), key({})]);
    expect(scope.allowedFunctions).toBeUndefined();
  });

  it("carries the most permissive explicit rate limit, never an unbounded one", () => {
    expect(inheritedScope([key({ rateLimit: 10 }), key({ rateLimit: 25 })]).rateLimit).toBe(25);
  });

  it("leaves the rate limit to the env default only if a key already does", () => {
    expect(inheritedScope([key({ rateLimit: 10 }), key({})]).rateLimit).toBeUndefined();
  });
});

describe("isTenantOrgDisabled — session callers respect an org-wide disable", () => {
  const setRows = (total: number, enabled: number) => {
    rows.length = 0;
    rows.push({ total: String(total), enabled: String(enabled) });
  };

  it("is disabled when every key the org holds is disabled", async () => {
    setRows(2, 0);
    await expect(isTenantOrgDisabled("tenant_all_off")).resolves.toBe(true);
  });

  it("is not disabled while any key remains enabled", async () => {
    setRows(2, 1);
    await expect(isTenantOrgDisabled("tenant_partial")).resolves.toBe(false);
  });

  it("is not disabled for a portal-only org that has never issued a key", async () => {
    setRows(0, 0);
    await expect(isTenantOrgDisabled("tenant_no_keys")).resolves.toBe(false);
  });
});

describe("resolveTenant — expired API keys are rejected", () => {
  const tenantRow = (apiKey: string, expiresAt: Date | null) => ({
    key_hash: hashApiKey(apiKey),
    tenant_id: `tenant_${apiKey}`,
    name: null,
    disabled: false,
    rate_limit: null,
    allowed_origins: null,
    allowed_functions: null,
    expires_at: expiresAt,
    created_at: new Date("2026-08-15T00:00:00.000Z"),
  });

  it("returns undefined for an expired key", async () => {
    rows.length = 0;
    rows.push(tenantRow("expired-key", new Date("2000-01-01T00:00:00.000Z")));

    await expect(resolveTenant("expired-key")).resolves.toBeUndefined();
  });

  it("resolves a key whose expiry is still in the future", async () => {
    rows.length = 0;
    rows.push(tenantRow("future-key", new Date("2999-01-01T00:00:00.000Z")));

    await expect(resolveTenant("future-key")).resolves.toMatchObject({ tenantId: "tenant_future-key" });
  });
});
