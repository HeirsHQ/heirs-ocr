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
 * Auth to attach to an upstream `/v1/ocr/*` call. In a multi-tenant deployment the
 * caller is a signed-in tenant, so we forward **their** `tenant_session` cookie —
 * the backend resolves it to that tenant, scoping usage/billing to them (never a
 * single shared key). `OCR_API_KEY` remains only as a **dev fallback** for a
 * keyless/`AUTH_ENABLED=false` setup or an unauthenticated probe.
 */
export const ocrForwardAuth = (req: NextRequest): Record<string, string> => {
  const token = req.cookies.get(TENANT_SESSION_COOKIE)?.value;
  if (token) return { cookie: `${TENANT_SESSION_COOKIE}=${token}` };
  const key = process.env.OCR_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
};
