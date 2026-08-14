import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Async path coverage: prove the queue + worker are wired to the same pipeline
 * the sync path uses. BullMQ and its Redis connection are faked with an
 * in-memory job store so `enqueue` → `getStatus` and the worker's `processJob`
 * can be exercised without a live Redis.
 */

// In-memory BullMQ: one shared job map, driven directly by tests to simulate
// the states BullMQ would report (waiting/active/completed/failed).
type FakeJob = {
  id: string;
  data: { function: string; request: { tenantId: string } };
  state: "waiting" | "active" | "completed" | "failed";
  returnvalue?: unknown;
  failedReason?: string;
  getState(): Promise<string>;
};

const { jobs } = vi.hoisted(() => ({ jobs: new Map<string, FakeJob>() }));

vi.mock("bullmq", () => {
  let seq = 0;
  class Queue {
    constructor(
      public name: string,
      public opts: unknown,
    ) {}
    async add(_name: string, data: FakeJob["data"]) {
      const id = String(++seq);
      const job: FakeJob = { id, data, state: "waiting", getState: async () => job.state };
      jobs.set(id, job);
      return { id };
    }
    async getJob(id: string) {
      return jobs.get(id);
    }
  }
  class Worker {
    constructor(
      public name: string,
      public processor: unknown,
      public opts: unknown,
    ) {}
    on() {
      return this;
    }
    async close() {}
  }
  class UnrecoverableError extends Error {}
  return { Queue, Worker, UnrecoverableError };
});

// createQueueConnection() news up an IORedis; keep it from touching a real socket.
vi.mock("ioredis", () => ({
  default: class {
    quit() {}
    disconnect() {}
  },
}));

// processJob() resolves deps through the composition root; swap in test deps
// (no Azure, no Redis cache) so it runs the real pipeline off a fake job.
import { PlainTextProvider } from "../src/providers/plain-text";
import { MockLlmClient } from "../src/llm/azure";
import { noopCache } from "../src/cache";
import { defaultProviderPolicy } from "../src/config/providers";
import { logger } from "../src/observability/logger";
import type { PipelineDeps } from "../src/pipeline";

const testDeps: PipelineDeps = {
  llm: new MockLlmClient(),
  logger,
  providers: [new PlainTextProvider()],
  cache: noopCache,
  policy: defaultProviderPolicy,
};

vi.mock("../src/http/deps", () => ({ getPipelineDeps: () => testDeps }));

// The worker meters processed documents against the subscription. Stub the store so
// the assertion is on the call the worker makes, not on Postgres.
const { recordDocumentUsage } = vi.hoisted(() => ({ recordDocumentUsage: vi.fn() }));
vi.mock("../src/billing/subscriptions", () => ({ recordDocumentUsage }));

// Metering is deduped with a Redis `SET NX` on the job id. Model just those
// semantics so the once-per-job guarantee is asserted rather than the client.
const { meterMarkers } = vi.hoisted(() => ({ meterMarkers: new Map<string, string>() }));
vi.mock("../src/redis", () => ({
  getRedis: () => ({
    set: async (key: string, value: string, _ex: string, _ttl: number, nx?: string) => {
      if (nx === "NX" && meterMarkers.has(key)) return null;
      meterMarkers.set(key, value);
      return "OK";
    },
  }),
}));

import { ocrQueue, encodeJobError, type OcrJobData } from "../src/jobs/queue";
import { processJob } from "../src/jobs/worker";
import type { OcrRequest } from "../src/pipeline";

const jobData = (over: Partial<OcrRequest> = {}, fn = "TEXT_EXTRACTION"): OcrJobData => ({
  function: fn,
  request: {
    file: { buffer: Buffer.from("hello async"), originalName: "doc.txt" },
    args: {},
    requestId: "req_test",
    tenantId: "tenant_a",
    ...over,
  },
});

beforeEach(() => {
  jobs.clear();
  recordDocumentUsage.mockClear();
});

describe("ocrQueue — enqueue + status", () => {
  it("enqueue returns a job id and stores the payload", async () => {
    const id = await ocrQueue.enqueue(jobData());
    expect(id).toBeTruthy();
    expect(jobs.get(id)?.data.function).toBe("TEXT_EXTRACTION");
  });

  it("reports a freshly-enqueued job as queued", async () => {
    const id = await ocrQueue.enqueue(jobData());
    const record = await ocrQueue.getStatus(id);
    expect(record).toMatchObject({ jobId: id, status: "queued", tenantId: "tenant_a" });
  });

  it("maps an active job to 'active'", async () => {
    const id = await ocrQueue.enqueue(jobData());
    jobs.get(id)!.state = "active";
    expect((await ocrQueue.getStatus(id))?.status).toBe("active");
  });

  it("flattens a completed job's outcome into the sync success shape", async () => {
    const id = await ocrQueue.enqueue(jobData());
    const job = jobs.get(id)!;
    job.state = "completed";
    job.returnvalue = { result: { text: "done" }, meta: { provider: "plain-text" } };
    const record = await ocrQueue.getStatus(id);

    expect(record?.status).toBe("completed");
    // `result`/`meta` sit at the top level, matching POST /v1/ocr/:function — not
    // nested as `result.result`, which forced clients to fork on the two paths.
    expect(record?.result).toEqual({ text: "done" });
    expect(record?.meta).toEqual({ provider: "plain-text" });
    expect(record?.function).toBe(jobData().function);
  });

  it("decodes the typed OcrError code from a failed job's reason", async () => {
    const id = await ocrQueue.enqueue(jobData());
    const job = jobs.get(id)!;
    job.state = "failed";
    job.failedReason = encodeJobError("PAGE_LIMIT_EXCEEDED", "too many pages");
    const record = await ocrQueue.getStatus(id);
    expect(record?.status).toBe("failed");
    expect(record?.error).toEqual({ code: "PAGE_LIMIT_EXCEEDED", message: "too many pages" });
  });

  it("falls back to EXTRACTION_FAILED for an unrecognized failure reason", async () => {
    const id = await ocrQueue.enqueue(jobData());
    const job = jobs.get(id)!;
    job.state = "failed";
    job.failedReason = "some raw crash without a code";
    expect((await ocrQueue.getStatus(id))?.error).toEqual({
      code: "EXTRACTION_FAILED",
      message: "some raw crash without a code",
    });
  });

  it("returns undefined for an unknown job id", async () => {
    expect(await ocrQueue.getStatus("nope")).toBeUndefined();
  });
});

describe("worker.processJob — runs the same pipeline off-request", () => {
  it("resolves the function and runs it to a result", async () => {
    const outcome = (await processJob(jobData())) as { result: { text: string }; meta: { provider: string } };
    expect(outcome.result.text).toBe("hello async");
    expect(outcome.meta.provider).toBe("plain-text");
  });

  it("revives a JSON-serialized Buffer (BullMQ round-trips file bytes as an object)", async () => {
    // After Redis serialization, file.buffer arrives as { type: "Buffer", data: [...] }.
    const serialized = { type: "Buffer", data: [...Buffer.from("revived bytes")] } as unknown as Buffer;
    const outcome = (await processJob(jobData({ file: { buffer: serialized, originalName: "doc.txt" } }))) as {
      result: { text: string };
    };
    expect(outcome.result.text).toBe("revived bytes");
  });

  it("throws a typed INVALID_ARGS for an unknown function", async () => {
    await expect(processJob(jobData({}, "NOPE_FUNCTION"))).rejects.toMatchObject({ code: "INVALID_ARGS" });
  });

  it("meters the processed document against the subscription (async path bills too)", async () => {
    const outcome = (await processJob(jobData())) as { meta: { pageCount: number; tokensUsed?: number } };
    expect(recordDocumentUsage).toHaveBeenCalledTimes(1);
    expect(recordDocumentUsage).toHaveBeenCalledWith("tenant_a", {
      pages: outcome.meta.pageCount,
      tokensUsed: outcome.meta.tokensUsed,
    });
  });

  it("does not meter when the job fails before the pipeline runs", async () => {
    await expect(processJob(jobData({}, "NOPE_FUNCTION"))).rejects.toBeTruthy();
    expect(recordDocumentUsage).not.toHaveBeenCalled();
  });

  it("meters a redelivered job only once", async () => {
    // BullMQ hands a stalled job to another worker; both can reach the meter.
    await processJob(jobData(), "job-dup");
    await processJob(jobData(), "job-dup");
    expect(recordDocumentUsage).toHaveBeenCalledTimes(1);
  });

  it("meters distinct jobs independently", async () => {
    await processJob(jobData(), "job-a");
    await processJob(jobData(), "job-b");
    expect(recordDocumentUsage).toHaveBeenCalledTimes(2);
  });
});
