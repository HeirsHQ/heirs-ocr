import { NextRequest } from "next/server";

import { ocrApiUrl } from "@/lib/ocr";

/**
 * BFF proxy for the backend admin API. Forwards `/api/admin/<slug>` to
 * `${OCR_API_URL}/admin/api/<slug>`, so the browser only ever talks same-origin to
 * Next (the backend is CORS-closed and server-to-server).
 *
 * Session handling: the backend issues an httpOnly `admin_session` cookie scoped to
 * `Path=/admin`. We forward that cookie upstream on every request, and re-home any
 * `Set-Cookie` the backend returns (login/logout) by rewriting `Path=/admin` → `Path=/`
 * so the browser stores it for the Next origin and sends it back here.
 */

const SESSION_COOKIE = "admin_session";

async function proxy(req: NextRequest, slug: string[]): Promise<Response> {
  const path = slug.map(encodeURIComponent).join("/");
  const target = `${ocrApiUrl()}/admin/api/${path}${req.nextUrl.search}`;

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

  const resHeaders = new Headers();
  resHeaders.set("content-type", upstream.headers.get("content-type") ?? "application/json");
  for (const cookie of upstream.headers.getSetCookie()) {
    resHeaders.append("set-cookie", cookie.replace(/Path=\/admin/gi, "Path=/"));
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
