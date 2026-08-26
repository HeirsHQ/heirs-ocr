import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The delivery loop's decisions: what counts as success, what retries, and when a
 * delivery is declared dead.
 *
 * The store is stubbed rather than run against pg-mem because the claim statement
 * uses a CTE with `FOR UPDATE ... SKIP LOCKED`, which pg-mem cannot parse — and that
 * clause is exactly what stops two workers sending the same delivery, so it is not
 * something to trade away for testability. What is exercised here is everything
 * built on top of it.
 */
const { assertSafeWebhookUrl, claimed, markDelivered, markFailed, reapOrphanedDeliveries } = vi.hoisted(() => ({
  assertSafeWebhookUrl: vi.fn(async (_url: string) => {}),
  claimed: { value: [] as unknown[] },
  markDelivered: vi.fn(async () => {}),
  markFailed: vi.fn(async () => {}),
  reapOrphanedDeliveries: vi.fn(async () => 0),
}));

vi.mock("../src/webhooks/store", () => ({
  claimDueDeliveries: async () => claimed.value,
  markDelivered,
  markFailed,
  reapOrphanedDeliveries,
}));
vi.mock("../src/observability/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * The destination guard is stubbed, not run for real, because the real one is inert
 * outside production (src/webhooks/url-guard.ts) — so against a live guard every case
 * below would pass whether the worker consulted it or not, which is exactly the bug
 * worth catching. The classifier it decides with is pinned separately in
 * webhooks.test.ts. Default is "allowed", matching the real no-op, so the existing
 * cases read unchanged.
 */
vi.mock("../src/webhooks/url-guard", () => ({ assertSafeWebhookUrl }));

import { drainWebhookOutbox, MAX_ATTEMPTS } from "../src/webhooks/deliver";

const due = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  endpointId: "e1",
  tenantId: "acme",
  event: "document.processed",
  payload: { hello: "world" },
  attempts: 1,
  url: "https://example.test/hook",
  secret: "whsec_test",
  ...over,
});

const respondWith = (status: number) => vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;

beforeEach(() => {
  claimed.value = [];
  assertSafeWebhookUrl.mockReset(); // drops any unconsumed `...Once`, not just the call log
  markDelivered.mockClear();
  markFailed.mockClear();
  reapOrphanedDeliveries.mockClear();
});

describe("drainWebhookOutbox", () => {
  it("does nothing when the outbox is empty", async () => {
    const result = await drainWebhookOutbox();
    expect(result.attempted).toBe(0);
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it("reaps deliveries whose endpoint is gone, every pass", async () => {
    reapOrphanedDeliveries.mockResolvedValueOnce(3);
    // They would otherwise sit pending forever: the claim joins the endpoint, so a
    // row without one is never picked up and never resolved.
    expect((await drainWebhookOutbox()).orphansReaped).toBe(3);
  });

  it("marks a 2xx as delivered", async () => {
    claimed.value = [due()];
    vi.stubGlobal("fetch", respondWith(200));

    await drainWebhookOutbox();
    expect(markDelivered).toHaveBeenCalledWith("d1", 200);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("treats every 2xx as success, not just 200", async () => {
    claimed.value = [due()];
    vi.stubGlobal("fetch", respondWith(204));

    await drainWebhookOutbox();
    expect(markDelivered).toHaveBeenCalledWith("d1", 204);
  });

  it("schedules a retry on a 5xx", async () => {
    claimed.value = [due({ attempts: 2 })];
    vi.stubGlobal("fetch", respondWith(500));

    await drainWebhookOutbox();
    const call = markFailed.mock.calls[0]![0] as { retryAt?: Date; responseStatus?: number };
    expect(call.responseStatus).toBe(500);
    expect(call.retryAt).toBeInstanceOf(Date);
    expect(call.retryAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("retries a 4xx too, rather than giving up immediately", async () => {
    claimed.value = [due()];
    vi.stubGlobal("fetch", respondWith(404));

    await drainWebhookOutbox();
    // A 404 is usually a deploy in flight or a path about to be fixed; dropping the
    // event on the first one would lose data the tenant could have had.
    expect((markFailed.mock.calls[0]![0] as { retryAt?: Date }).retryAt).toBeInstanceOf(Date);
  });

  it("declares a delivery dead once attempts are exhausted", async () => {
    claimed.value = [due({ attempts: MAX_ATTEMPTS })];
    vi.stubGlobal("fetch", respondWith(500));

    await drainWebhookOutbox();
    const call = markFailed.mock.calls[0]![0] as { retryAt?: Date };
    expect(call.retryAt).toBeUndefined();
  });

  it("retries when the receiver never answers", async () => {
    claimed.value = [due()];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    await drainWebhookOutbox();
    const call = markFailed.mock.calls[0]![0] as { retryAt?: Date; error: string };
    expect(call.retryAt).toBeInstanceOf(Date);
    expect(call.error).toContain("ECONNREFUSED");
  });

  it("signs the request and lets the receiver dedupe a retry", async () => {
    claimed.value = [due()];
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await drainWebhookOutbox();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Heirs-Signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    // Same id across retries, so a receiver can recognise a repeat.
    expect(headers["X-Heirs-Delivery"]).toBe("d1");
    expect(headers["X-Heirs-Event"]).toBe("document.processed");
    expect(init.body).toBe(JSON.stringify({ hello: "world" }));
  });

  it("does not follow redirects", async () => {
    claimed.value = [due()];
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await drainWebhookOutbox();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // A signed request must not be replayed to wherever a 302 points.
    expect(init.redirect).toBe("manual");
  });

  it("sends a slow receiver's neighbours anyway", async () => {
    claimed.value = [due({ id: "a" }), due({ id: "b" })];
    vi.stubGlobal("fetch", respondWith(200));

    // Deliveries in a batch go to unrelated hosts, so they run concurrently.
    expect((await drainWebhookOutbox()).attempted).toBe(2);
    expect(markDelivered).toHaveBeenCalledTimes(2);
  });
});

describe("destination re-check at send time", () => {
  const blocked = () => new Error("10.0.0.5 is not a public address");

  it("re-checks the destination on every attempt, not only at registration", async () => {
    claimed.value = [due()];
    vi.stubGlobal("fetch", respondWith(200));

    await drainWebhookOutbox();
    // The URL was already checked when the tenant saved it; checking it again here is
    // what closes DNS rebinding, where the name resolved publicly then and privately now.
    expect(assertSafeWebhookUrl).toHaveBeenCalledWith("https://example.test/hook");
  });

  it("does not send to a destination the guard refuses", async () => {
    claimed.value = [due()];
    assertSafeWebhookUrl.mockRejectedValueOnce(blocked());
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await drainWebhookOutbox();
    // The point of the guard: the request is never made at all.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it("marks a blocked delivery dead rather than retrying it", async () => {
    claimed.value = [due({ attempts: 0 })];
    assertSafeWebhookUrl.mockRejectedValueOnce(blocked());
    vi.stubGlobal("fetch", respondWith(200));

    await drainWebhookOutbox();
    const call = markFailed.mock.calls[0]![0] as { id: string; retryAt?: Date; error: string };
    expect(call.id).toBe("d1");
    // Attempts are nowhere near exhausted, and it still must not come back: unlike a
    // 502, a destination inside the network is not a condition that clears on the next
    // tick, and each retry is another attempt to reach somewhere it must never reach.
    expect(call.retryAt).toBeUndefined();
    expect(call.error).toContain("not a public address");
  });

  it("blocks one delivery without stopping its neighbours", async () => {
    claimed.value = [due({ id: "bad", url: "https://rebound.test/hook" }), due({ id: "good" })];
    assertSafeWebhookUrl.mockImplementationOnce(async (url: string) => {
      if (url === "https://rebound.test/hook") throw blocked();
    });
    vi.stubGlobal("fetch", respondWith(200));

    // One tenant's bad destination is not an outage for everyone else in the batch.
    expect((await drainWebhookOutbox()).attempted).toBe(2);
    expect(markDelivered).toHaveBeenCalledTimes(1);
    expect(markDelivered).toHaveBeenCalledWith("good", 200);
  });
});
