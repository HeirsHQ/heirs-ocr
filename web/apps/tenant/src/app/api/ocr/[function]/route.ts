import { NextRequest } from "next/server";

import { ocrApiUrl, ocrForwardAuth } from "@/lib/ocr";

/**
 * Proxy for running an OCR function. Forwards the multipart upload (file + args)
 * to `POST ${OCR_API_URL}/v1/ocr/:function`, attaching the signed-in tenant's
 * session (see ocrForwardAuth) so the run is scoped and billed to that tenant.
 * Status and JSON body (success envelope or typed error) pass straight through.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ function: string }> }) {
  // `function` is a reserved word — read it as a property rather than destructuring.
  const fnKey = (await ctx.params).function;

  const incoming = await req.formData();
  const upstream = new FormData();
  const file = incoming.get("file");
  if (file) upstream.append("file", file);
  const args = incoming.get("args");
  if (typeof args === "string") upstream.append("args", args);

  const res = await fetch(`${ocrApiUrl()}/v1/ocr/${encodeURIComponent(fnKey)}`, {
    method: "POST",
    headers: ocrForwardAuth(req), // fetch sets the multipart content-type + boundary for FormData
    body: upstream,
    cache: "no-store",
  });

  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
