import { NextRequest } from "next/server";

import { ocrApiUrl, ocrErrorResponse, ocrForwardAuth, relayUpstream } from "@/lib/ocr";

/**
 * Proxy for async job status. Anything the backend routes to the queue (a document
 * over the size/page threshold) answers `202 {jobId}` instead of a result, and the
 * client polls here until the job reaches a terminal state. Forwards the signed-in
 * tenant's session so the backend can scope the lookup — a job belonging to another
 * tenant is reported as not-found.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const auth = ocrForwardAuth(req);
  if (!auth) return ocrErrorResponse(401, "UNAUTHORIZED", "Sign in to use the OCR API.");

  const res = await fetch(`${ocrApiUrl()}/v1/ocr/jobs/${encodeURIComponent(id)}`, {
    headers: auth,
    cache: "no-store",
  });
  return relayUpstream(res);
}
