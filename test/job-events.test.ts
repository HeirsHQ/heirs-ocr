import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fan-out of BullMQ job transitions to the consoles subscribed to them.
 *
 * The behaviour that matters is the routing: the queue's event stream carries a job
 * id and nothing else, so the tenant is resolved by a lookup — and a mistake there
 * leaks one tenant's job activity into another's console.
 */

/** Captures the handlers `ensureSubscribed` registers, so a test can fire them. */
const { handlers, closed, QueueEventsMock } = vi.hoisted(() => {
  const handlers = new Map<string, (payload: { jobId?: string }) => void>();
  const closed = { count: 0 };
  class QueueEventsMock {
    on(name: string, fn: (payload: { jobId?: string }) => void) {
      handlers.set(name, fn);
      return this;
    }
    async close() {
      closed.count += 1;
    }
  }
  return { handlers, closed, QueueEventsMock };
});

vi.mock("bullmq", () => ({ QueueEvents: QueueEventsMock }));

const { getStatus } = vi.hoisted(() => ({ getStatus: vi.fn() }));

vi.mock("../src/jobs/queue", () => ({
  OCR_QUEUE_NAME: "ocr",
  createQueueConnection: () => ({}) as never,
  ocrQueue: { getStatus },
}));

import { closeJobEvents, subscribeToJobEvents, type JobEvent } from "../src/jobs/events";

const emit = async (name: string, jobId: string | undefined): Promise<void> => {
  handlers.get(name)?.({ jobId });
  // dispatch is async and deliberately not awaited by the emitter.
  await vi.waitFor(() => expect(getStatus).toHaveBeenCalled());
};

const job = (over: Partial<JobEvent> = {}): JobEvent => ({
  jobId: "1",
  status: "active",
  tenantId: "acme",
  function: "TEXT_EXTRACTION",
  createdAt: 1,
  ...over,
});

beforeEach(async () => {
  await closeJobEvents();
  handlers.clear();
  closed.count = 0;
  getStatus.mockReset();
});

describe("subscribeToJobEvents", () => {
  it("delivers a transition to the tenant that owns the job", async () => {
    getStatus.mockResolvedValue(job({ status: "queued" }));
    const received: JobEvent[] = [];
    subscribeToJobEvents("acme", (e) => received.push(e));

    await emit("waiting", "1");

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ jobId: "1", status: "queued", tenantId: "acme" });
  });

  it("never delivers one tenant's job to another's listener", async () => {
    getStatus.mockResolvedValue(job({ tenantId: "acme" }));
    const acme: JobEvent[] = [];
    const other: JobEvent[] = [];
    subscribeToJobEvents("acme", (e) => acme.push(e));
    subscribeToJobEvents("globex", (e) => other.push(e));

    await emit("active", "1");

    expect(acme).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it("strips the result — a completed extraction is too big to push", async () => {
    getStatus.mockResolvedValue({ ...job({ status: "completed" }), result: { text: "x".repeat(1000) } });
    const received: JobEvent[] = [];
    subscribeToJobEvents("acme", (e) => received.push(e));

    await emit("completed", "1");

    expect(received[0]).not.toHaveProperty("result");
    expect(received[0]).toMatchObject({ status: "completed" });
  });

  it("forwards every lifecycle transition, including the ones polling used to miss", async () => {
    getStatus.mockResolvedValue(job());
    const received: JobEvent[] = [];
    subscribeToJobEvents("acme", (e) => received.push(e));

    for (const name of ["waiting", "active", "completed", "failed", "delayed"]) {
      expect(handlers.has(name)).toBe(true);
    }
  });

  it("stops delivering once unsubscribed, so a reload does not leak a listener", async () => {
    getStatus.mockResolvedValue(job());
    const received: JobEvent[] = [];
    const unsubscribe = subscribeToJobEvents("acme", (e) => received.push(e));

    await emit("active", "1");
    expect(received).toHaveLength(1);

    unsubscribe();
    getStatus.mockClear();
    handlers.get("active")?.({ jobId: "1" });
    await new Promise((r) => setTimeout(r, 10));

    // With no listeners left the lookup is skipped entirely, not merely ignored.
    expect(getStatus).not.toHaveBeenCalled();
    expect(received).toHaveLength(1);
  });

  it("drops an event whose job cannot be resolved rather than broadcasting it", async () => {
    getStatus.mockResolvedValue(undefined);
    const received: JobEvent[] = [];
    subscribeToJobEvents("acme", (e) => received.push(e));

    await emit("failed", "999");

    expect(received).toHaveLength(0);
  });

  it("keeps serving other listeners when one throws", async () => {
    getStatus.mockResolvedValue(job());
    const received: JobEvent[] = [];
    subscribeToJobEvents("acme", () => {
      throw new Error("this connection is gone");
    });
    subscribeToJobEvents("acme", (e) => received.push(e));

    await emit("active", "1");

    expect(received).toHaveLength(1);
  });
});
