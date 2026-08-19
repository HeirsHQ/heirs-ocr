import { NextRequest } from "next/server";

import { ocrApiUrl } from "@/lib/ocr";

/**
 * BFF proxy for the backend tenant portal API. Forwards `/api/tenant/<slug>` to
 * `${OCR_API_URL}/tenant/api/<slug>`, so the browser only ever talks same-origin to
 * Next (the backend is CORS-closed and server-to-server).
 *
 * Session handling mirrors the admin proxy: the backend issues an httpOnly
 * `tenant_session` cookie. We forward it upstream on every request; the backend
 * already scopes it to `Path=/`, so any `Set-Cookie` (login/logout) passes straight
 * through for the browser to store against the Next origin — the same cookie the
 * `/api/ocr/*` proxy then forwards to run OCR in-app.
 */

const SESSION_COOKIE = "tenant_session";

async function proxy(req: NextRequest, slug: string[]): Promise<Response> {
  const path = slug.map(encodeURIComponent).join("/");
  const target = `${ocrApiUrl()}/tenant/api/${path}${req.nextUrl.search}`;

  const headers: Record<string, string> = {};
  const contentType = req.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) headers["cookie"] = `${SESSION_COOKIE}=${token}`;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? await req.text() : undefined,
    cache: "no-store",
    redirect: "manual",
  });

  const upstreamType = upstream.headers.get("content-type") ?? "application/json";
  const resHeaders = new Headers();
  resHeaders.set("content-type", upstreamType);
  for (const cookie of upstream.headers.getSetCookie()) {
    resHeaders.append("set-cookie", cookie);
  }

  // Server-sent events are passed straight through as a stream. `await
  // upstream.text()` below waits for the body to end, and an event stream never
  // ends — buffering it would hang the request until the connection died and then
  // deliver every event at once, which is strictly worse than the polling it
  // replaces. Everything else is small and JSON, so it stays buffered.
  if (upstream.body && upstreamType.includes("text/event-stream")) {
    resHeaders.set("cache-control", "no-cache, no-transform");
    resHeaders.set("connection", "keep-alive");
    return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
  }

  return new Response(await upstream.text(), { status: upstream.status, headers: resHeaders });
}

type Ctx = { params: Promise<{ slug: string[] }> };
const run = (req: NextRequest, ctx: Ctx) => ctx.params.then(({ slug }) => proxy(req, slug));

export const GET = run;
export const POST = run;
export const PUT = run;
export const PATCH = run;
export const DELETE = run;
