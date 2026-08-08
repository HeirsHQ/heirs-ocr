import type { NextFunction, Request, Response } from "express";

import { timingSafeEqual } from "crypto";
import { env } from "../../config/env";

/**
 * Baseline browser-security headers, applied to every response. This is the
 * hardened subset that actually matters for this service — a JSON API plus a
 * cookie-authenticated admin console served from the same origin — without pulling
 * in a dependency:
 *
 *   - `X-Content-Type-Options: nosniff`  — no MIME sniffing.
 *   - `X-Frame-Options: DENY` + a framing-free CSP `frame-ancestors 'none'` —
 *     the admin console can't be framed, so it can't be clickjacked.
 *   - `Referrer-Policy: no-referrer`     — never leak URLs/tokens via Referer.
 *   - `Cross-Origin-Opener-Policy`       — isolate the browsing context.
 *   - HSTS over HTTPS only               — don't send it on plain HTTP (a browser
 *     would cache it against the bare host and can break local http).
 *
 * The CSP is intentionally strict: the admin UI is self-hosted static assets with
 * no third-party origins, so `default-src 'self'` holds. `style-src` allows inline
 * styles because the shipped console uses them.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const isHttps = (req: Request): boolean =>
  req.secure || (req.get("x-forwarded-proto") ?? "").split(",")[0]!.trim().toLowerCase() === "https";

export const securityHeaders = (req: Request, res: Response, next: NextFunction): void => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", CSP);
  if (isHttps(req)) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
};

/** Constant-time string compare that tolerates unequal lengths. */
const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

/**
 * Guards the Prometheus `/metrics` endpoint. When `METRICS_AUTH_TOKEN` is set, a
 * matching `Authorization: Bearer <token>` is required; otherwise the endpoint is
 * left open (for a genuinely private scrape network) but that is the operator's
 * explicit choice, warned about at boot in src/index.ts.
 */
export const metricsAuth = (req: Request, res: Response, next: NextFunction): void => {
  const expected = env.METRICS_AUTH_TOKEN;
  if (!expected) {
    next();
    return;
  }
  const header = req.get("authorization") ?? "";
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value || !safeEqual(value.trim(), expected)) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "metrics: missing or invalid token" } });
    return;
  }
  next();
};
