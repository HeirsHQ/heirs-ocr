import type { NextFunction, Request, Response } from "express";

import { recordApiRequest } from "../../observability/request-log";

/**
 * Records each OCR API call against the tenant that made it.
 *
 * Mounted at the **top** of the OCR router, before `auth`, so it also sees the
 * requests that were refused further down the chain — a 402 over quota, a 429, a 403
 * on a function the plan does not include. Those never become documents, and they are
 * exactly what someone debugging an integration comes looking for.
 *
 * The write happens on `finish` rather than inline, so it is off the response path
 * entirely: the client already has its answer by the time the row is inserted.
 *
 * `req.tenantId` is read at finish time, not on the way in — `auth` populates it
 * mid-chain. A request that failed *authentication* therefore has no tenant to
 * attribute it to and is not recorded; there is no way to know whose log it belongs
 * in, and guessing from a rejected key would be worse than the gap.
 */
/**
 * The OCR function a request targeted, from the path.
 *
 * Read from the URL rather than `req.params`: this middleware is mounted with
 * `router.use`, and Express only binds route parameters on the layer that matched, so
 * `req.params.function` is empty here no matter when it is read.
 *
 * `POST /v1/ocr/:function` is the only shape that names one — `/functions` (the
 * catalog) and `/jobs/:id` are not function calls and get `undefined`.
 */
const functionKeyOf = (req: Request): string | undefined => {
  if (req.method !== "POST") return undefined;
  const segment = (req.path ?? "").split("/").filter(Boolean)[0];
  return segment && segment !== "functions" && segment !== "jobs" ? segment : undefined;
};

export const requestLog = (req: Request, res: Response, next: NextFunction): void => {
  const startedAt = Date.now();

  /**
   * The typed error envelope carries the code, and every denial path in this service
   * renders through `res.json`. Wrapping it once here captures all of them — the
   * alternative is threading a code out of each middleware and the error handler
   * separately, and missing one silently.
   */
  let errorCode: string | undefined;
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    const code = (body as { error?: { code?: unknown } })?.error?.code;
    if (typeof code === "string") errorCode = code;
    return json(body);
  };

  res.on("finish", () => {
    const tenantId = req.tenantId;
    if (!tenantId) return;

    void recordApiRequest({
      tenantId,
      requestId: req.requestId,
      method: req.method,
      // `originalUrl` minus the query string: a query can carry parameters that are
      // not ours to store, and the path is what identifies the call.
      path: (req.originalUrl ?? req.url).split("?")[0] ?? req.url,
      functionKey: functionKeyOf(req),
      statusCode: res.statusCode,
      errorCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
};
