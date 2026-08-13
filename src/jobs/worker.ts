import { UnrecoverableError, Worker } from "bullmq";

import { OCR_QUEUE_NAME, createQueueConnection, encodeJobError, type OcrJobData } from "./queue";
import { runPipeline, type OcrRequest } from "../pipeline";
import { getFunction } from "../functions/registry";
import { logger } from "../observability/logger";
import { getPipelineDeps } from "../http/deps";
import { recordDocumentUsage } from "../billing/subscriptions";
import { getRedis } from "../redis";
import { OcrError } from "../http/errors";

/** Off-request jobs are less latency-sensitive; a modest fixed concurrency. */
const WORKER_CONCURRENCY = 4;

/**
 * Queue worker. Pulls {@link OcrJobData}, resolves the function
 * from the registry, and runs the same `runPipeline` the sync path uses — the
 * only difference is it happens off-request.
 */
export const processJob = async (data: OcrJobData, jobId?: string): Promise<unknown> => {
  const def = getFunction(data.function);
  if (!def) {
    throw new OcrError("INVALID_ARGS", `Unknown function '${data.function}'`);
  }
  const request = reviveRequest(data.request);
  const outcome = await runPipeline(def, request, getPipelineDeps());
  // Meter the processed document against the subscription — the sync path does this
  // inline in the route handler (routes.ts), so the async path must do it here or a
  // queued job would be billed as free. Fire-and-forget; `recordDocumentUsage`
  // resolves the subscription itself and no-ops when the tenant has none. Only
  // reached on success — `runPipeline` throws (before this line) on failure.
  await meterOnce(jobId, request.tenantId, {
    pages: outcome.meta.pageCount,
    tokensUsed: outcome.meta.tokensUsed,
  });
  return outcome;
};

/** How long a job's "already metered" marker is kept — well past `removeOnFail`. */
const METER_MARKER_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Meters a document at most once per job.
 *
 * BullMQ re-delivers a **stalled** job (a worker that locks up mid-pipeline loses its
 * lock and the job is handed to another worker), and with retries enabled a job can
 * reach this line more than once. Without a job-scoped guard each delivery would
 * increment period usage, accrue the charge again, and burn another trial document —
 * i.e. double-bill the tenant. A Redis `SET NX` claims the job id first; only the
 * claimant meters.
 *
 * Degrades to metering when the marker cannot be written: under-billing is recoverable
 * from the append-only request log, and dropping metering entirely on a Redis blip
 * would silently serve everything for free.
 */
const meterOnce = async (
  jobId: string | undefined,
  tenantId: string,
  data: { pages: number; tokensUsed?: number },
): Promise<void> => {
  if (jobId) {
    try {
      const claimed = await getRedis().set(`meter:job:${jobId}`, "1", "EX", METER_MARKER_TTL_SECONDS, "NX");
      if (claimed !== "OK") {
        logger.warn("skipping duplicate metering for redelivered job", { jobId, tenantId });
        return;
      }
    } catch (err) {
      logger.warn("metering dedupe unavailable; metering anyway", {
        jobId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  recordDocumentUsage(tenantId, data);
};

/**
 * Starts the BullMQ worker loop. Call from a dedicated worker entrypoint. Returns
 * the {@link Worker} so the entrypoint can close it on shutdown.
 */
export const startWorker = (): Worker<OcrJobData> => {
  const worker = new Worker<OcrJobData>(
    OCR_QUEUE_NAME,
    async (job) => {
      try {
        return await processJob(job.data, job.id);
      } catch (err) {
        // Encode the typed code so the job-status lookup can recover it — Redis
        // only persists the failure *message*, not the error object.
        if (err instanceof OcrError) {
          const encoded = encodeJobError(err.code, err.message);
          // A non-retryable OcrError is deterministic (bad args, unsupported media,
          // page limit): replaying it just burns the backoff window and delays the
          // client's `failed` status by minutes. Fail it on the first attempt.
          throw err.retryable ? new Error(encoded) : new UnrecoverableError(encoded);
        }
        throw err;
      }
    },
    { connection: createQueueConnection(), concurrency: WORKER_CONCURRENCY },
  );

  worker.on("completed", (job) => logger.info("job completed", { jobId: job.id }));
  worker.on("failed", (job, err) => logger.error("job failed", { jobId: job?.id, err: err.message }));
  worker.on("error", (err) => logger.error("worker error", { err: err.message }));

  return worker;
};

/**
 * BullMQ serializes job data as JSON, so `file.buffer` arrives as a plain
 * `{ type: "Buffer", data: number[] }` rather than a {@link Buffer}. Reconstruct
 * it so the pipeline receives real bytes.
 */
const reviveRequest = (request: OcrRequest): OcrRequest => ({
  ...request,
  file: { ...request.file, buffer: toBuffer(request.file.buffer) },
});

const toBuffer = (value: unknown): Buffer => {
  if (Buffer.isBuffer(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) {
    return Buffer.from((value as { data: number[] }).data);
  }
  throw new OcrError("EXTRACTION_FAILED", "Job payload is missing valid file bytes");
};
