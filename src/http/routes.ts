import { Router, type Request, type Response, type NextFunction } from "express";

import { buildCatalog, getFunction } from "../functions/registry";
import { authorizeFunction } from "./middleware/authorize";
import { sensitivity } from "./middleware/sensitivity";
import { FILE_FIELD, upload } from "../ingest/upload";
import { rateLimit } from "./middleware/rate-limit";
import { runPipeline, type OcrRequest } from "../pipeline";
import { sendSuccess } from "./respond";
import { getPipelineDeps } from "./deps";
import { auth } from "./middleware/auth";
import { OcrError } from "./errors";
import "./context";

/** Form field carrying the function arguments as a JSON string. */
export const ARGS_FIELD = "args";

/** Parses the multipart `args` field (a JSON string) into the raw args object. */
const parseArgsField = (raw: unknown): unknown => {
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new OcrError("INVALID_ARGS", `The '${ARGS_FIELD}' field must be a valid JSON string`);
  }
};

/**
 * HTTP contract:
 *   GET  /v1/ocr/functions   → catalog + JSON Schemas
 *   POST /v1/ocr/:function    → multipart file + args (JSON string)
 *   GET  /v1/ocr/jobs/:id     → async job status + result
 */
export const ocrRouter = Router();

ocrRouter.get("/functions", (_req: Request, res: Response) => {
  res.json({ functions: buildCatalog() });
});

ocrRouter.post(
  "/:function",
  auth,
  authorizeFunction,
  rateLimit,
  sensitivity,
  upload.single(FILE_FIELD),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const fnKey = String(req.params.function ?? "");
      const def = getFunction(fnKey);
      if (!def) {
        throw new OcrError("INVALID_ARGS", `Unknown function '${fnKey}'`);
      }
      if (!req.file) {
        throw new OcrError("INVALID_ARGS", `File is required in the '${FILE_FIELD}' field`);
      }

      const request: OcrRequest = {
        file: { buffer: req.file.buffer, originalName: req.file.originalname },
        args: parseArgsField(req.body?.[ARGS_FIELD]),
        requestId: req.requestId!,
        tenantId: req.tenantId!,
      };

      // Sync path. The async queue (size/page threshold → 202 + statusUrl) is a
      // later seam; both paths call the identical `runPipeline`.
      const outcome = await runPipeline(def, request, getPipelineDeps());
      sendSuccess(res, 200, {
        requestId: request.requestId,
        function: def.key,
        result: outcome.result,
        meta: outcome.meta,
      });
    } catch (err) {
      next(err);
    }
  },
);

ocrRouter.get("/jobs/:id", async (_req: Request, _res: Response, next: NextFunction) => {
  // TODO: look up job status/result from the queue.
  next(new OcrError("INTERPRETATION_FAILED", "Job lookup not implemented", { retryable: false }));
});
