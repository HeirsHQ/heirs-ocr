import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

import { generateApiKey, hashApiKey, isTenantKeyExpired } from "../src/auth/tenants";
import { auth } from "../src/http/middleware/auth";
import { OcrError } from "../src/http/errors";

describe("tenant key helpers", () => {
  it("hashApiKey is deterministic sha256 hex", () => {
    const a = hashApiKey("secret-key");
    const b = hashApiKey("secret-key");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey("other")).not.toBe(a);
  });

  it("generateApiKey returns distinct high-entropy tokens", () => {
    const k1 = generateApiKey();
    const k2 = generateApiKey();
    expect(k1).not.toBe(k2);
    expect(k1).toMatch(/^hok_test_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generateApiKey can mint explicit test and live keys", () => {
    expect(generateApiKey("test")).toMatch(/^hok_test_/);
    expect(generateApiKey("live")).toMatch(/^hok_live_/);
  });

  it("isTenantKeyExpired treats missing and future expiry as active", () => {
    const now = new Date("2026-08-15T12:00:00.000Z");
    expect(isTenantKeyExpired({}, now)).toBe(false);
    expect(isTenantKeyExpired({ expiresAt: "2026-08-15T12:00:01.000Z" }, now)).toBe(false);
  });

  it("isTenantKeyExpired treats the exact expiry instant as expired", () => {
    const now = new Date("2026-08-15T12:00:00.000Z");
    expect(isTenantKeyExpired({ expiresAt: "2026-08-15T12:00:00.000Z" }, now)).toBe(true);
    expect(isTenantKeyExpired({ expiresAt: "2026-08-15T11:59:59.000Z" }, now)).toBe(true);
  });
});

describe("auth middleware", () => {
  it("rejects a request with no API key (before touching the store)", async () => {
    const req = { header: () => undefined } as unknown as Request;
    const next = vi.fn();
    await auth(req, {} as Response, next);

    const err = next.mock.calls[0]![0] as unknown;
    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).code).toBe("UNAUTHORIZED");
    // A request id is always stamped, even on rejection.
    expect((req as Request).requestId).toMatch(/^req_/);
  });
});
