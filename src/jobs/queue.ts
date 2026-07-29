import type { OcrRequest } from "../pipeline";

/**
 * Async job queue. Requests go async when `pageCount > threshold`
 * or `sizeBytes > threshold`. Same registry, same `execute`; the worker just
 * calls the pipeline off-request. Backed by BullMQ over Redis.
 */
export type OcrJobData = {
  function: string;
  request: OcrRequest;
};

export type JobStatus = "queued" | "active" | "completed" | "failed";

export type JobRecord = {
  jobId: string;
  status: JobStatus;
  result?: unknown;
  error?: { code: string; message: string };
};

export interface OcrQueue {
  enqueue(data: OcrJobData): Promise<string>;
  getStatus(jobId: string): Promise<JobRecord | undefined>;
}

// TODO: BullMQ-backed implementation using env.REDIS_URL.
export const ocrQueue: OcrQueue = {
  enqueue: async () => {
    throw new Error("ocrQueue.enqueue: not implemented");
  },
  getStatus: async () => {
    throw new Error("ocrQueue.getStatus: not implemented");
  },
};
