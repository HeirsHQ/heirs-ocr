import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";

/**
 * The liveness and readiness endpoints as HTTP.
 *
 * These two are the only routes an orchestrator calls, and getting their gating
 * backwards is a whole-fleet outage rather than a failed request: a `/healthz` that
 * consults Redis restarts every pod into the same outage, and a `/readyz` that
 * answers 200 with an unreachable Postgres keeps a pod in rotation to fail traffic
 * it cannot serve. Neither mistake is visible from a unit test of
 * `checkDependencies`, which is why this drives the real app over a socket.
 *
 * `checkDependencies` itself is doubled — what is under test is which of its answers
 * gate, not that Redis can be pinged.
 */
const checkDependencies = vi.hoisted(() => vi.fn());

vi.mock("../src/observability/health", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/observability/health")>()),
  checkDependencies,
}));

// Access logging is an edge like any other here, and an unmocked morgan writes a
// line per request into the suite's output.
vi.mock("morgan", () => ({ default: () => (_req: unknown, _res: unknown, next: () => void) => next() }));

// The app pulls the routers in, which reach for the stores at import time.
vi.mock("../src/db", () => ({ query: vi.fn(), ensureSchema: vi.fn(), closeDb: vi.fn() }));
vi.mock("../src/redis", () => ({
  getRedis: vi.fn(() => ({ ping: vi.fn() })),
  closeRedis: vi.fn(),
}));

import { main } from "../src/main";

const app = main();

let server: ReturnType<typeof app.listen>;
let base = "";

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    }),
);

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  checkDependencies.mockReset();
});

type Body = { status?: string; redis?: boolean; postgres?: boolean; blob?: boolean };

const get = async (path: string): Promise<{ status: number; body: Body }> => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Body };
};

describe("liveness", () => {
  it("answers ok without consulting any dependency", async () => {
    const res = await get("/healthz");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    // The point of the endpoint: a store outage must not get every pod killed.
    expect(checkDependencies).not.toHaveBeenCalled();
  });
});

describe("readiness", () => {
  it("serves when both hard dependencies answer", async () => {
    checkDependencies.mockResolvedValue({ redis: true, postgres: true, blob: true });

    const res = await get("/readyz");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("takes the pod out of rotation when Redis is unreachable", async () => {
    checkDependencies.mockResolvedValue({ redis: false, postgres: true, blob: true });

    const res = await get("/readyz");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unavailable");
  });

  it("takes the pod out of rotation when Postgres is unreachable", async () => {
    checkDependencies.mockResolvedValue({ redis: true, postgres: false, blob: true });

    const res = await get("/readyz");

    expect(res.status).toBe(503);
  });

  it("stays ready when only blob storage is down, which is optional", async () => {
    checkDependencies.mockResolvedValue({ redis: true, postgres: true, blob: false });

    const res = await get("/readyz");

    expect(res.status).toBe(200);
  });

  it("reports each dependency so a 503 says which one failed", async () => {
    checkDependencies.mockResolvedValue({ redis: false, postgres: true, blob: false });

    const res = await get("/readyz");

    expect(res.body).toMatchObject({ redis: false, postgres: true, blob: false });
  });
});
