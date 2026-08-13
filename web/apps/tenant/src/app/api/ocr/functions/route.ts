import { NextRequest } from "next/server";

import { ocrApiUrl, ocrForwardAuth } from "@/lib/ocr";

/**
 * Proxy for the OCR function catalog. The OCR API is server-to-server and
 * CORS-closed, so the browser can't call it directly — this same-origin route
 * forwards to `${OCR_API_URL}/v1/ocr/functions`, attaching the signed-in tenant's
 * session (see ocrForwardAuth) so the call is scoped to that tenant.
 */
export async function GET(req: NextRequest) {
  const res = await fetch(`${ocrApiUrl()}/v1/ocr/functions`, {
    headers: ocrForwardAuth(req),
    cache: "no-store",
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}
