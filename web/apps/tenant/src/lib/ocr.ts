import type { NextRequest } from "next/server";

/**
 * Server-side config for reaching the OCR backend from the Next proxy routes.
 * Read only in route handlers (never shipped to the browser).
 */

/** Base URL of the OCR API. Defaults to the local dev server. */
export const ocrApiUrl = (): string => process.env.OCR_API_URL ?? "http://localhost:8080";

/** The tenant-portal session cookie (mirrors the backend's `tenant_session`). */
export const TENANT_SESSION_COOKIE = "tenant_session";

/**
 * Whether an *unauthenticated* caller may fall back to the shared `OCR_API_KEY`.
 *
 * Off unless explicitly opted in. `/api/ocr/*` is excluded from the proxy's auth
 * gate (the matcher skips `api`), so with an unconditional fallback any anonymous
 * caller on the internet could POST a document and have it run — and be billed and
 * rate-limited — against whichever tenant owns that key. The fallback exists only
 * for a local, keyless (`AUTH_ENABLED=false`) backend.
 */
const anonymousAllowed = (): boolean => process.env.OCR_ALLOW_ANONYMOUS === "true";

/**
 * Auth to attach to an upstream `/v1/ocr/*` call, or `null` when the caller is not
 * signed in and anonymous access is not enabled — the route must then 401 rather
 * than spend the shared key. In a multi-tenant deployment the caller is a signed-in
 * tenant, so we forward **their** `tenant_session` cookie and the backend resolves
 * it to that tenant, scoping usage and billing to them.
 */
export const ocrForwardAuth = (req: NextRequest): Record<string, string> | null => {
  const token = req.cookies.get(TENANT_SESSION_COOKIE)?.value;
  if (token) return { cookie: `${TENANT_SESSION_COOKIE}=${token}` };

  if (!anonymousAllowed()) return null;
  const key = process.env.OCR_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
};

/** The backend's error envelope, so the client can parse proxy and API errors alike. */
export const ocrErrorResponse = (status: number, code: string, message: string): Response =>
  new Response(JSON.stringify({ error: { code, message, retryable: false } }), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Relay an upstream response verbatim. The content-type is carried over rather than
 * asserted as JSON: a gateway 502 with an HTML body would otherwise reach the client
 * labelled `application/json` and blow up in `res.json()` as a misleading
 * "network error" instead of the actual upstream failure.
 */
export const relayUpstream = async (res: Response): Promise<Response> =>
  new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
