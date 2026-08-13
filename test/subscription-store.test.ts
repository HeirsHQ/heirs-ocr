import { describe, expect, it, vi } from "vitest";

/**
 * The billing store must fail **closed**. A Postgres fault has to stay
 * distinguishable from "this tenant has no subscription row" — if the two collapse
 * into `undefined`, `requireSubscription` waives every limit for every tenant at
 * once: quota, entitlement, sensitivity, file-size and page caps skipped, the rate
 * ceiling reset to the env default, and nothing metered.
 */

const { query, mode } = vi.hoisted(() => {
  const mode = { fail: false };
  const query = vi.fn(async () => {
    if (mode.fail) throw new Error("connection terminated unexpectedly");
    return { rows: [] };
  });
  return { query, mode };
});

vi.mock("../src/db", () => ({
  query,
  ensureSchema: async () => {},
  whenDbReady: async () => {},
  closeDb: async () => {},
}));

import { resolveSubscription, SubscriptionStoreUnavailableError } from "../src/billing/subscriptions";
import { requireSubscription } from "../src/http/middleware/require-subscription";
import { OcrError } from "../src/http/errors";

/** Minimal Express doubles; only what the middleware touches. */
const runMiddleware = async (tenantId: string) => {
  const req = { tenantId, params: { function: "TEXT_EXTRACTION" } } as never;
  let passed: unknown = "not-called";
  await requireSubscription(
    req,
    {} as never,
    ((err?: unknown) => {
      passed = err;
    }) as never,
  );
  return passed;
};

/** Unique per assertion — `resolveSubscription` caches per tenant. */
let n = 0;
const tenant = () => `tenant_store_${++n}`;

describe("resolveSubscription — store faults are not 'no subscription'", () => {
  it("returns undefined when the tenant genuinely has no row", async () => {
    mode.fail = false;
    await expect(resolveSubscription(tenant())).resolves.toBeUndefined();
  });

  it("throws SubscriptionStoreUnavailableError when the store cannot be read", async () => {
    mode.fail = true;
    await expect(resolveSubscription(tenant())).rejects.toBeInstanceOf(SubscriptionStoreUnavailableError);
    mode.fail = false;
  });
});

describe("requireSubscription — fails closed on a billing outage", () => {
  it("passes the request through when the tenant has no subscription (unlimited)", async () => {
    mode.fail = false;
    expect(await runMiddleware(tenant())).toBeUndefined();
  });

  it("answers 503 PROVIDER_UNAVAILABLE instead of waiving limits", async () => {
    mode.fail = true;
    const err = await runMiddleware(tenant());
    mode.fail = false;

    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((err as OcrError).retryable).toBe(true);
  });

  it("does not publish a subscription or rate ceiling when the store is down", async () => {
    mode.fail = true;
    const req = { tenantId: tenant(), params: { function: "TEXT_EXTRACTION" } } as never;
    await requireSubscription(req, {} as never, (() => {}) as never);
    mode.fail = false;

    expect((req as { subscription?: unknown }).subscription).toBeUndefined();
  });
});
