import type { OcrJobData } from "./queue";

/**
 * Queue worker. Pulls {@link OcrJobData}, resolves the function
 * from the registry, and runs the same `runPipeline` the sync path uses — the
 * only difference is it happens off-request.
 */
export const processJob = async (_data: OcrJobData): Promise<unknown> => {
  // TODO: getFunction(data.function) → runPipeline(def, data.request, deps) → persist result.
  throw new Error("processJob: not implemented");
};

/** Starts the BullMQ worker loop. Call from a dedicated worker entrypoint. */
export const startWorker = (): void => {
  // TODO: new Worker(queueName, async (job) => processJob(job.data), { connection }).
  throw new Error("startWorker: not implemented");
};
