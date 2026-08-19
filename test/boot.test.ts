import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Store readiness at boot.
 *
 * The behaviour under test is tolerance of a *transient* failure: a DNS hiccup
 * resolving a managed host surfaces as `EAI_AGAIN` — "try again" — and used to exit
 * the process permanently. Under an orchestrator a restart hid that; run locally
 * there is nothing to restart it, so the backend stayed down over a condition that
 * clears in seconds.
 */
const { redisReady, dbReady } = vi.hoisted(() => ({
  redisReady: vi.fn(async () => {}),
  dbReady: vi.fn(async () => {}),
}));

vi.mock("../src/redis", () => ({ whenRedisReady: redisReady }));
vi.mock("../src/db", () => ({ whenDbReady: dbReady }));
vi.mock("../src/observability/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { waitForStores } from "../src/boot";

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  redisReady.mockReset().mockResolvedValue(undefined);
  dbReady.mockReset().mockResolvedValue(undefined);
});

/**
 * Runs `waitForStores` with the retry delays fast-forwarded.
 *
 * The rejection is observed *before* the timers are advanced. Without that the
 * promise sits unhandled while the loop runs and Node reports an unhandled
 * rejection, which vitest surfaces as a run error even though the assertion passes.
 */
const run = (attempts?: number): Promise<void> => {
  const promise = waitForStores(attempts);
  const observed = promise.then(
    () => undefined,
    () => undefined,
  );

  const advance = (async () => {
    // Let each attempt settle, then skip its backoff.
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(10_000);
    await observed;
  })();

  return advance.then(() => promise);
};

describe("waitForStores", () => {
  it("returns immediately when both stores answer", async () => {
    await expect(run()).resolves.toBeUndefined();
    expect(redisReady).toHaveBeenCalledTimes(1);
    expect(dbReady).toHaveBeenCalledTimes(1);
  });

  it("rides out a transient failure and succeeds on a later attempt", async () => {
    redisReady
      .mockRejectedValueOnce(new Error("getaddrinfo EAI_AGAIN valkey.example.com"))
      .mockResolvedValue(undefined);

    await expect(run()).resolves.toBeUndefined();
    // The blip cost one attempt; the boot continued rather than exiting.
    expect(redisReady).toHaveBeenCalledTimes(2);
  });

  it("re-checks both stores on a retry, not just the one that failed", async () => {
    dbReady.mockRejectedValueOnce(new Error("Postgres not ready")).mockResolvedValue(undefined);

    await expect(run()).resolves.toBeUndefined();
    expect(redisReady).toHaveBeenCalledTimes(2);
    expect(dbReady).toHaveBeenCalledTimes(2);
  });

  it("still fails when a store is genuinely unreachable", async () => {
    redisReady.mockRejectedValue(new Error("Redis not ready after 30000ms"));

    // Retrying must not turn a real outage into a hang: the boot still ends in a
    // rejection so the entrypoint exits non-zero for an orchestrator to act on.
    await expect(run()).rejects.toThrow(/Redis not ready/);
    expect(redisReady).toHaveBeenCalledTimes(3);
  });

  it("honours a caller-supplied attempt count", async () => {
    dbReady.mockRejectedValue(new Error("down"));
    await expect(run(2)).rejects.toThrow(/down/);
    expect(dbReady).toHaveBeenCalledTimes(2);
  });
});

// ── Background workers ────────────────────────────────────────────────────────

describe("RUN_BACKGROUND_WORKERS default", () => {
  it("defaults to on, so a single container is a complete service", async () => {
    // The two failure modes are not symmetric: off in a single-container deploy means
    // queued documents are never processed, retention never runs and webhooks queue
    // forever — all silently. On, where a worker also exists, only costs some shared
    // load. The default has to be the one that always works.
    const { env } = await import("../src/config/env");
    expect(env.RUN_BACKGROUND_WORKERS).toBe("true");
  });
});
