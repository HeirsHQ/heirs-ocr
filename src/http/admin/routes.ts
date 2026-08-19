import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";

import { clearLoginFailures, loginAllowed, recordLoginFailure } from "../../auth/login-throttle";
import { getSettings, putSettings, type SettingsNamespace } from "../../config/settings-store";
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  listSessions,
  revokeOtherSessions,
} from "../../auth/admin-session";
import { consumeChallenge, createChallenge, peekChallenge } from "../../auth/mfa-challenge";
import {
  beginEnrolment,
  confirmEnrolment,
  disableMfa,
  getMfaStatus,
  isMfaEnabled,
  MfaAlreadyEnabledError,
  regenerateRecoveryCodes,
  verifyMfa,
} from "../../auth/mfa";
import { deletePlan, getStoredPlan, listPlans, putPlan } from "../../billing/plan-store";
import { createBackup, getBackup, listBackups, restoreBackup } from "../../ops/backups";
import { adminAuth, parseCookies, requireMinRole } from "../middleware/admin-auth";
import { checkDependencies, providerStatus } from "../../observability/health";
import { listAuditEventsPage, recordAuditEvent } from "../../observability/audit";
import { listDocumentsPage } from "../../observability/documents";
import { isIpAllowed } from "../../auth/ip-allowlist";
import { assertPasswordPolicy } from "../../auth/password-policy";
import { personLabel, tenantLabel } from "../../observability/audit-labels";
import { runRetentionSweep } from "../../jobs/retention";
import { createTenantUser, listTenantUsers } from "../../auth/tenant-users";
import { recentLogs, type LogLevel } from "../../observability/log-buffer";
import { getMetricsSummary } from "../../observability/metrics";
import { pageParams, paginate, paginatedFrom } from "../pagination";
import { getAllTenantUsage } from "../../observability/usage";
import { parsePlanInput } from "../../billing/plan-schema";
import { listFunctions } from "../../functions/registry";
import { logger } from "../../observability/logger";
import { getQueueStats } from "../../jobs/queue";
import type { User } from "../../types/user";
import { env } from "../../config/env";
import {
  countOwners,
  createAdmin,
  deleteAdmin,
  getAdminByEmail,
  getAdminById,
  listAdmins,
  updateAdmin,
  verifyPassword,
} from "../../auth/admins";
import {
  generateApiKey,
  getTenantByHash,
  listKeysForTenant,
  listTenants,
  putTenant,
  revokeByHash,
  updateTenantByHash,
  type Tenant,
} from "../../auth/tenants";
import {
  assignablePlan,
  createSubscriptionFromPlan,
  getSubscriptionSummary,
  listSubscriptions,
  toEffectiveSubscription,
  putSubscription,
  resolveSubscription,
  SubscriptionStoreUnavailableError,
} from "../../billing/subscriptions";

/**
 * Admin console JSON API, mounted under `/admin` (paths here start with `/api`).
 * `POST /api/login` is the only open route; everything else requires a session
 * (`adminAuth`) and a minimum role (`requireMinRole`). Read routes are `viewer+`,
 * tenant mutations `manager+`, admin-user management `owner`.
 */
export const adminApiRouter = Router();

const ROLE = z.enum(["owner", "manager", "viewer"]);

/** Trims a record down to the public {@link User} — never leak the password hash. */
const publicUser = (u: User): User => ({
  id: u.id,
  email: u.email,
  name: u.name,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

const sendError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ error: { code, message } });
};

/** Wraps an async handler so a thrown error becomes a 500 JSON instead of a hang. */
const handler =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch((err) => {
      logger.error("admin route failed", { path: req.path, err: err instanceof Error ? err.message : String(err) });
      // If a response already went out, hand the error to Express so it can close
      // the socket — don't send again (that throws "headers already sent").
      if (res.headersSent) {
        next(err);
        return;
      }
      sendError(res, 500, "INTERNAL", "Unexpected error");
    });
  };

/**
 * True when the browser reached us over HTTPS — directly (`req.secure`) or via a
 * TLS-terminating proxy that forwards the original scheme in `X-Forwarded-Proto`.
 * We read the header ourselves rather than enabling global `trust proxy`, which
 * would also change `req.ip` resolution (the rate limiter keys on it).
 */
const isHttpsRequest = (req: Request): boolean =>
  req.secure || (req.get("x-forwarded-proto") ?? "").split(",")[0]!.trim().toLowerCase() === "https";

/**
 * httpOnly session cookie, scoped to the console. `secure` is set from the actual
 * request scheme, not `NODE_ENV`: a `Secure` cookie is dropped by the browser over
 * plain HTTP, so tying it to `NODE_ENV=production` silently breaks any non-local
 * deployment served over HTTP (login succeeds, but the cookie is never stored, so
 * every subsequent request 401s). Over HTTPS the flag is still set.
 */
const setSessionCookie = (req: Request, res: Response, token: string, ttlSeconds: number): void => {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttpsRequest(req),
    path: "/admin",
    maxAge: ttlSeconds * 1000,
  });
};

// ── Auth ────────────────────────────────────────────────────────────────────

/**
 * Provenance recorded against a new session, so the security page can show a person
 * *which* sign-ins are live rather than an anonymous count. Both fields are
 * self-reported by the client — useful for recognising your own devices, not
 * evidence of anything.
 */
const sessionContext = (req: Request): { ip?: string; userAgent?: string } => ({
  ip: req.ip,
  // Bounded: a user-agent is attacker-controlled and lands in a Redis value.
  userAgent: req.get("user-agent")?.slice(0, 200),
});

const loginSchema = z.object({ email: z.string().min(1), password: z.string().min(1) });

adminApiRouter.post(
  "/api/login",
  handler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", "email and password are required");
      return;
    }

    const ip = req.ip ?? "unknown";
    const email = parsed.data.email;

    // Brute-force throttle: refuse once too many recent failures accrue against
    // this IP or email. Argon2 slows each guess; this bounds how many can be made.
    if (!(await loginAllowed("admin", ip, email))) {
      logger.warn("admin.login.throttled", { email, ip });
      sendError(res, 429, "RATE_LIMITED", "Too many failed attempts. Try again later.");
      return;
    }

    // The admin store (Redis) is a hard dependency for this security control. If it
    // is unreachable, fail closed with 503 rather than a generic 500 — mirrors the
    // OCR auth middleware (src/http/middleware/auth.ts). A wrong password is a 401
    // below; only a store outage lands here.
    // The platform allowlist applies to every operator, so it needs no lookup and is
    // checked before anything else. Until now this setting was stored and displayed
    // but never enforced — a control that existed only on the settings page.
    const security = await getSettings("security");
    if (!isIpAllowed(ip, security.ipAllowlist)) {
      logger.warn("admin.login.ip_denied", { email, ip });
      sendError(res, 403, "FORBIDDEN", "Sign-in is not permitted from this network");
      return;
    }

    let admin, session;
    try {
      admin = await getAdminByEmail(email);
      // Same response whether the email is unknown or the password is wrong.
      if (!admin || !(await verifyPassword(admin, parsed.data.password))) {
        await recordLoginFailure("admin", ip, email);
        // Log every failure so a brute-force attempt is visible to alerting.
        logger.warn("admin.login.failed", { email, ip });
        sendError(res, 401, "UNAUTHORIZED", "Invalid email or password");
        return;
      }
      // A correct password on an enrolled account buys a short-lived challenge, not
      // a session — see src/auth/mfa-challenge.ts for why the cookie must wait.
      if (await isMfaEnabled("admins", admin.id)) {
        const challenge = await createChallenge("admin", { userId: admin.id, email: admin.email });
        await clearLoginFailures("admin", ip, email);
        logger.info("admin.login.mfa_required", { adminId: admin.id, email: admin.email, ip });
        res.json({ mfaRequired: true, challenge });
        return;
      }
      session = await createSession(admin.id, admin.role, sessionContext(req));
    } catch (err) {
      logger.error("admin login: store unavailable", { err: err instanceof Error ? err.message : String(err) });
      sendError(res, 503, "PROVIDER_UNAVAILABLE", "Authentication store unavailable");
      return;
    }

    await clearLoginFailures("admin", ip, email);
    setSessionCookie(req, res, session.token, session.ttl);
    logger.info("admin.login", { adminId: admin.id, email: admin.email, ip });
    res.json({ user: publicUser(admin), role: admin.role });
  }),
);

// ── Second factor ─────────────────────────────────────────────────────────────
// Redeeming a challenge (open, like login) and managing enrolment (session-bound).

const mfaLoginSchema = z.object({ challenge: z.string().min(1), code: z.string().min(1) });

adminApiRouter.post(
  "/api/login/mfa",
  handler(async (req, res) => {
    const parsed = mfaLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", "challenge and code are required");
      return;
    }

    const ip = req.ip ?? "unknown";
    const pending = await peekChallenge("admin", parsed.data.challenge);
    if (!pending) {
      // Expired, already spent, or forged — all the same to the caller.
      sendError(res, 401, "UNAUTHORIZED", "Login session expired. Sign in again.");
      return;
    }

    // The code is guessable in a way the password is not (a million possibilities,
    // rotating every 30s), so it counts against the same throttle buckets.
    if (!(await loginAllowed("admin", ip, pending.email))) {
      logger.warn("admin.login.mfa.throttled", { email: pending.email, ip });
      sendError(res, 429, "RATE_LIMITED", "Too many failed attempts. Try again later.");
      return;
    }

    let session, admin;
    try {
      const factor = await verifyMfa("admins", pending.userId, parsed.data.code);
      if (!factor) {
        await recordLoginFailure("admin", ip, pending.email);
        logger.warn("admin.login.mfa.failed", { adminId: pending.userId, email: pending.email, ip });
        sendError(res, 401, "UNAUTHORIZED", "Invalid verification code");
        return;
      }

      admin = await getAdminById(pending.userId);
      // Disabled or deleted between the two steps — the challenge must not outlive it.
      if (!admin || admin.disabled) {
        await consumeChallenge("admin", parsed.data.challenge);
        sendError(res, 401, "UNAUTHORIZED", "Invalid email or password");
        return;
      }

      await consumeChallenge("admin", parsed.data.challenge);
      session = await createSession(admin.id, admin.role, sessionContext(req));
      logger.info("admin.login", { adminId: admin.id, email: admin.email, ip, factor });
    } catch (err) {
      logger.error("admin mfa: store unavailable", { err: err instanceof Error ? err.message : String(err) });
      sendError(res, 503, "PROVIDER_UNAVAILABLE", "Authentication store unavailable");
      return;
    }

    await clearLoginFailures("admin", ip, pending.email);
    setSessionCookie(req, res, session.token, session.ttl);
    res.json({ user: publicUser(admin), role: admin.role });
  }),
);

// ── Password ──────────────────────────────────────────────────────────────────

const changePasswordSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(1),
});

/**
 * Self-service password change for the signed-in operator. The console's twin of the
 * portal's route — see the note there for why the current password is required,
 * why failures throttle, and why other sessions are revoked.
 */
adminApiRouter.post(
  "/api/security/password",
  adminAuth,
  handler(async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", "current and next are required");
      return;
    }

    const ip = req.ip ?? "unknown";
    const admin = await getAdminById(req.admin!.userId);
    if (!admin) {
      sendError(res, 401, "UNAUTHORIZED", "Account no longer exists");
      return;
    }

    if (!(await loginAllowed("admin", ip, admin.email))) {
      sendError(res, 429, "RATE_LIMITED", "Too many failed attempts. Try again later.");
      return;
    }

    if (!(await verifyPassword(admin, parsed.data.current))) {
      await recordLoginFailure("admin", ip, admin.email);
      logger.warn("admin.password.change_failed", { adminId: admin.id, ip });
      sendError(res, 401, "UNAUTHORIZED", "Current password is incorrect");
      return;
    }

    if (parsed.data.next === parsed.data.current) {
      sendError(res, 400, "INVALID_ARGS", "New password must be different from the current one");
      return;
    }

    try {
      await assertPasswordPolicy(parsed.data.next);
    } catch (err) {
      sendError(res, 400, "INVALID_ARGS", err instanceof Error ? err.message : "Password does not meet policy");
      return;
    }

    await updateAdmin(admin.id, { password: parsed.data.next }, admin.id);
    await clearLoginFailures("admin", ip, admin.email);

    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const revoked = await revokeOtherSessions(admin.id, token);

    await recordAuditEvent({
      action: "admin.password.changed",
      actor: admin.id,
      actorLabel: personLabel(admin),
      target: admin.id,
      targetLabel: personLabel(admin),
      metadata: { sessionsRevoked: revoked },
    });
    res.json({ ok: true, sessionsRevoked: revoked });
  }),
);

// ── Active sessions ───────────────────────────────────────────────────────────

/** Live sessions for the signed-in operator. Tokens are never returned. */
adminApiRouter.get(
  "/api/security/sessions",
  adminAuth,
  handler(async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    res.json({ sessions: await listSessions(req.admin!.userId, token) });
  }),
);

/**
 * Signs the account out everywhere else, keeping the session making the request.
 *
 * Deliberately "all others" rather than per-session revocation: someone reaching for
 * this has lost a device or suspects a compromise, and picking the right row off a
 * list of IP addresses is exactly the judgement they cannot reliably make.
 */
adminApiRouter.delete(
  "/api/security/sessions",
  adminAuth,
  handler(async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const revoked = await revokeOtherSessions(req.admin!.userId, token);
    await recordAuditEvent({
      action: "admin.sessions.revoked",
      actor: req.admin!.userId,
      actorLabel: req.admin!.label,
      target: req.admin!.userId,
      metadata: { revoked },
    });
    res.json({ revoked });
  }),
);

adminApiRouter.get(
  "/api/security/mfa",
  adminAuth,
  handler(async (req, res) => {
    const status = await getMfaStatus("admins", req.admin!.userId);
    if (!status) {
      sendError(res, 401, "UNAUTHORIZED", "Account no longer exists");
      return;
    }
    res.json(status);
  }),
);

adminApiRouter.post(
  "/api/security/mfa",
  adminAuth,
  handler(async (req, res) => {
    const admin = await getAdminById(req.admin!.userId);
    if (!admin) {
      sendError(res, 401, "UNAUTHORIZED", "Account no longer exists");
      return;
    }
    try {
      res.json(await beginEnrolment("admins", admin.id, admin.email));
    } catch (err) {
      if (err instanceof MfaAlreadyEnabledError) {
        sendError(res, 409, "CONFLICT", err.message);
        return;
      }
      throw err;
    }
  }),
);

const mfaCodeSchema = z.object({ code: z.string().min(1) });

adminApiRouter.post(
  "/api/security/mfa/verify",
  adminAuth,
  handler(async (req, res) => {
    const parsed = mfaCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", "code is required");
      return;
    }

    const result = await confirmEnrolment("admins", req.admin!.userId, parsed.data.code);
    if (!result.ok) {
      sendError(res, 400, "INVALID_ARGS", "Invalid verification code");
      return;
    }

    await recordAuditEvent({
      action: "admin.mfa.enabled",
      actor: req.admin!.userId,
      actorLabel: req.admin!.label,
      target: req.admin!.userId,
      targetLabel: req.admin!.label,
    });
    // The plaintext codes exist only in this response — they are stored hashed.
    res.json({ enabled: true, recoveryCodes: result.recoveryCodes });
  }),
);

/**
 * Turning MFA off removes a security control, so it re-checks the password: a
 * session alone — which is exactly what an attacker who got past the factor holds
 * — must not be enough to strip the account back to one factor.
 */
const mfaDisableSchema = z.object({ password: z.string().min(1) });

adminApiRouter.delete(
  "/api/security/mfa",
  adminAuth,
  handler(async (req, res) => {
    const parsed = mfaDisableSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", "password is required");
      return;
    }

    const admin = await getAdminById(req.admin!.userId);
    if (!admin || !(await verifyPassword(admin, parsed.data.password))) {
      sendError(res, 401, "UNAUTHORIZED", "Invalid password");
      return;
    }

    await disableMfa("admins", admin.id);
    await recordAuditEvent({
      action: "admin.mfa.disabled",
      actor: admin.id,
      actorLabel: personLabel(admin),
      target: admin.id,
      targetLabel: personLabel(admin),
    });
    res.json({ enabled: false });
  }),
);

adminApiRouter.post(
  "/api/security/mfa/recovery-codes",
  adminAuth,
  handler(async (req, res) => {
    const parsed = mfaDisableSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", "password is required");
      return;
    }

    const admin = await getAdminById(req.admin!.userId);
    if (!admin || !(await verifyPassword(admin, parsed.data.password))) {
      sendError(res, 401, "UNAUTHORIZED", "Invalid password");
      return;
    }

    const recoveryCodes = await regenerateRecoveryCodes("admins", admin.id);
    if (!recoveryCodes) {
      sendError(res, 409, "CONFLICT", "Two-factor authentication is not enabled");
      return;
    }
    await recordAuditEvent({
      action: "admin.mfa.recovery_codes_regenerated",
      actor: admin.id,
      actorLabel: personLabel(admin),
      target: admin.id,
      targetLabel: personLabel(admin),
    });
    res.json({ recoveryCodes });
  }),
);

adminApiRouter.post(
  "/api/logout",
  adminAuth,
  handler(async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await destroySession(token);
    res.clearCookie(SESSION_COOKIE, { path: "/admin" });
    res.json({ ok: true });
  }),
);

adminApiRouter.get(
  "/api/me",
  adminAuth,
  handler(async (req, res) => {
    const admin = await getAdminById(req.admin!.userId);
    if (!admin) {
      sendError(res, 401, "UNAUTHORIZED", "Account no longer exists");
      return;
    }
    res.json({ user: publicUser(admin), role: admin.role });
  }),
);

// ── Admin users (owner only) ──────────────────────────────────────────────────

const createAdminSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: ROLE,
  password: z.string().min(8),
});

const updateAdminSchema = z.object({
  name: z.string().min(1).optional(),
  role: ROLE.optional(),
  disabled: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

adminApiRouter.get(
  "/api/admins",
  adminAuth,
  requireMinRole("owner"),
  handler(async (req, res) => {
    res.json(paginate(await listAdmins(), pageParams(req.query)));
  }),
);

adminApiRouter.post(
  "/api/admins",
  adminAuth,
  requireMinRole("owner"),
  handler(async (req, res) => {
    const parsed = createAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", parsed.error.issues[0]?.message ?? "Invalid admin");
      return;
    }

    // The platform's minimum-length policy applies wherever a password is set, not
    // only to self-service changes — otherwise raising it leaves every account
    // created by an owner on the old floor.
    if (parsed.data.password !== undefined) {
      try {
        await assertPasswordPolicy(parsed.data.password);
      } catch (err) {
        sendError(res, 400, "INVALID_ARGS", err instanceof Error ? err.message : "Password does not meet policy");
        return;
      }
    }
    try {
      const admin = await createAdmin(parsed.data, req.admin!.userId);
      await recordAuditEvent({
        action: "admin.created",
        actor: req.admin!.userId,
        actorLabel: req.admin!.label,
        target: admin.id,
        targetLabel: personLabel(admin),
        metadata: { email: admin.email, role: admin.role },
      });
      res.status(201).json({ admin });
    } catch (err) {
      sendError(res, 409, "CONFLICT", err instanceof Error ? err.message : "Could not create admin");
    }
  }),
);

adminApiRouter.patch(
  "/api/admins/:id",
  adminAuth,
  requireMinRole("owner"),
  handler(async (req, res) => {
    const parsed = updateAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", parsed.error.issues[0]?.message ?? "Invalid update");
      return;
    }

    // The platform's minimum-length policy applies wherever a password is set, not
    // only to self-service changes — otherwise raising it leaves every account
    // created by an operator on the old floor.
    if (parsed.data.password !== undefined) {
      try {
        await assertPasswordPolicy(parsed.data.password);
      } catch (err) {
        sendError(res, 400, "INVALID_ARGS", err instanceof Error ? err.message : "Password does not meet policy");
        return;
      }
    }
    const id = String(req.params.id);
    const target = await getAdminById(id);
    if (!target) {
      sendError(res, 404, "NOT_FOUND", "No such admin");
      return;
    }

    // Self-lockout guard: don't let the last active owner be demoted or disabled.
    const removesOwner =
      target.role === "owner" && ((parsed.data.role && parsed.data.role !== "owner") || parsed.data.disabled === true);
    if (removesOwner && (await countOwners()) <= 1) {
      sendError(res, 400, "LAST_OWNER", "Cannot demote or disable the last owner");
      return;
    }

    const admin = await updateAdmin(id, parsed.data, req.admin!.userId);
    await recordAuditEvent({
      action: "admin.updated",
      actor: req.admin!.userId,
      actorLabel: req.admin!.label,
      target: id,
      targetLabel: personLabel(admin ?? target),
      metadata: { role: parsed.data.role, disabled: parsed.data.disabled },
    });
    res.json({ admin });
  }),
);

adminApiRouter.delete(
  "/api/admins/:id",
  adminAuth,
  requireMinRole("owner"),
  handler(async (req, res) => {
    const id = String(req.params.id);
    const target = await getAdminById(id);
    if (!target) {
      sendError(res, 404, "NOT_FOUND", "No such admin");
      return;
    }
    if (target.role === "owner" && (await countOwners()) <= 1) {
      sendError(res, 400, "LAST_OWNER", "Cannot delete the last owner");
      return;
    }
    await deleteAdmin(id, req.admin!.userId);
    await recordAuditEvent({
      action: "admin.deleted",
      actor: req.admin!.userId,
      actorLabel: req.admin!.label,
      target: id,
      targetLabel: personLabel(target),
    });
    res.json({ ok: true });
  }),
);

/**
 * Operator escape hatch: clears another admin's second factor.
 *
 * Without this, losing both the authenticator and the recovery codes is a
 * permanent lockout — the secret is not recoverable and the codes are stored only
 * as hashes. Owner-only, and audited, because it is by definition a downgrade of
 * someone else's account security: verify the request out of band first.
 */
adminApiRouter.delete(
  "/api/admins/:id/mfa",
  adminAuth,
  requireMinRole("owner"),
  handler(async (req, res) => {
    const id = String(req.params.id);
    const target = await getAdminById(id);
    if (!target) {
      sendError(res, 404, "NOT_FOUND", "No such admin");
      return;
    }

    await disableMfa("admins", id, req.admin!.userId);
    await recordAuditEvent({
      action: "admin.mfa.reset",
      actor: req.admin!.userId,
      actorLabel: req.admin!.label,
      target: id,
      targetLabel: personLabel(target),
      metadata: { email: target.email },
    });
    logger.warn("admin.mfa.reset", { adminId: id, actor: req.admin!.userId });
    res.json({ enabled: false });
  }),
);

// ── Tenants ──────────────────────────────────────────────────────────────────

const csv = z.array(z.string().min(1));
const createTenantSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(1).optional(),
  rateLimit: z.number().int().positive().optional(),
  allowedFunctions: csv.optional(),
  allowedOrigins: csv.optional(),
});
const updateTenantSchema = z.object({
  name: z.string().min(1).optional(),
  rateLimit: z.number().int().positive().optional(),
  allowedFunctions: csv.optional(),
  allowedOrigins: csv.optional(),
  disabled: z.boolean().optional(),
});

adminApiRouter.get(
  "/api/tenants",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (req, res) => {
    res.json(paginate(await listTenants(), pageParams(req.query)));
  }),
);

adminApiRouter.get(
  "/api/tenants/:id",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (req, res) => {
    const tenantId = String(req.params.id);
    const keys = await listKeysForTenant(tenantId);
    if (!keys.length) {
      sendError(res, 404, "NOT_FOUND", "No such tenant");
      return;
    }
    const [users, subscription] = await Promise.all([
      listTenantUsers(tenantId),
      resolveSubscription(tenantId)
        .then((sub) => (sub ? toEffectiveSubscription(sub) : undefined))
        .catch(() => undefined),
    ]);
    res.json({
      tenant: keys[0]!.tenant,
      keys: keys.map((k) => k.keyHash),
      users,
      subscription: subscription ?? null,
      plan: subscription?.plan ?? null,
    });
  }),
);

adminApiRouter.post(
  "/api/tenants",
  adminAuth,
  requireMinRole("manager"),
  handler(async (req, res) => {
    const parsed = createTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", parsed.error.issues[0]?.message ?? "Invalid tenant");
      return;
    }
    // Tenants are keyed by key-hash (one org, many keys), so nothing in the schema
    // stops a second org being created under an existing `tenantId` — the two would
    // then share usage, subscription, and portal users. Reject here rather than add a
    // unique constraint: the multi-key shape is deliberate, only *this* entry point
    // means "new org". Minting a key for an existing org goes through /tenant/api/keys.
    const existing = await listKeysForTenant(parsed.data.tenantId);
    if (existing.length > 0) {
      sendError(res, 409, "CONFLICT", `A tenant with id '${parsed.data.tenantId}' already exists`);
      return;
    }
    const tenant: Tenant = { ...parsed.data, createdAt: new Date().toISOString() };
    const apiKey = generateApiKey();
    await putTenant(apiKey, tenant, { actor: req.admin!.userId });
    await recordAuditEvent({
      action: "tenant.created",
      actor: req.admin!.userId,
      actorLabel: req.admin!.label,
      target: tenant.tenantId,
      targetLabel: tenantLabel(tenant),
    });
    // The raw key is shown exactly once — it is never stored, only its hash.
    res.status(201).json({ tenant, apiKey });
  }),
);

adminApiRouter.patch(
  "/api/tenants/:keyHash",
  adminAuth,
  requireMinRole("manager"),
  handler(async (req, res) => {
    const parsed = updateTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", parsed.error.issues[0]?.message ?? "Invalid update");
      return;
    }
    const updated = await updateTenantByHash(String(req.params.keyHash), parsed.data, { actor: req.admin!.userId });
    if (!updated) {
      sendError(res, 404, "NOT_FOUND", "No such tenant");
      return;
    }
    await recordAuditEvent({
      action: "tenant.updated",
      actor: req.admin!.userId,
      actorLabel: req.admin!.label,
      target: updated.tenantId,
      targetLabel: tenantLabel(updated),
      metadata: parsed.data,
    });
    res.json({ tenant: updated });
  }),
);

adminApiRouter.delete(
  "/api/tenants/:keyHash",
  adminAuth,
  requireMinRole("manager"),
  handler(async (req, res) => {
    const keyHash = String(req.params.keyHash);
    // Read before revoking: afterwards the row is gone and the audit entry would
    // have nothing but an opaque hash to name.
    const doomed = await getTenantByHash(keyHash);
    const removed = await revokeByHash(keyHash, { actor: req.admin!.userId });
    if (removed === 0) {
      sendError(res, 404, "NOT_FOUND", "No such tenant");
      return;
    }
    await recordAuditEvent({
      action: "tenant.revoked",
      actor: req.admin!.userId,
      actorLabel: req.admin!.label,
      target: keyHash,
      // The key hash is opaque; name the org it belonged to instead.
      targetLabel: doomed ? tenantLabel(doomed) : undefined,
    });
    res.json({ ok: true });
  }),
);

// ── Tenant users (bootstrap the tenant portal) ────────────────────────────────
// Admins seed a tenant's first login so the org can reach the portal; thereafter a
// tenant owner manages their own team at /tenant/api/users.

const createTenantUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(["owner", "member"]).default("owner"),
  password: z.string().min(8),
});

adminApiRouter.get(
  "/api/tenants/:tenantId/users",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (req, res) => {
    res.json(paginate(await listTenantUsers(String(req.params.tenantId)), pageParams(req.query)));
  }),
);

adminApiRouter.post(
  "/api/tenants/:tenantId/users",
  adminAuth,
  requireMinRole("manager"),
  handler(async (req, res) => {
    const parsed = createTenantUserSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", parsed.error.issues[0]?.message ?? "Invalid user");
      return;
    }

    // Seeding a tenant's first owner sets a password too, so the policy applies here
    // as well — an operator-provisioned login must not be weaker than a self-set one.
    try {
      await assertPasswordPolicy(parsed.data.password);
    } catch (err) {
      sendError(res, 400, "INVALID_ARGS", err instanceof Error ? err.message : "Password does not meet policy");
      return;
    }
    try {
      const user = await createTenantUser({ tenantId: String(req.params.tenantId), ...parsed.data }, req.admin!.userId);
      res.status(201).json({ user });
    } catch (err) {
      sendError(res, 409, "CONFLICT", err instanceof Error ? err.message : "Could not create user");
    }
  }),
);

// ── Plans & subscriptions ─────────────────────────────────────────────────────

const assignSubscriptionSchema = z.object({ planId: z.string().min(1) });

/** Flatten a Zod failure into a one-line `path: message; …` string for the 400 body. */
const formatIssues = (error: z.ZodError): string =>
  error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");

adminApiRouter.get(
  "/api/plans",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (req, res) => {
    res.json(paginate(await listPlans(), pageParams(req.query)));
  }),
);

adminApiRouter.post(
  "/api/plans",
  adminAuth,
  requireMinRole("manager"),
  handler(async (req, res) => {
    const parsed = parsePlanInput(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", formatIssues(parsed.error));
      return;
    }
    if (await getStoredPlan(parsed.data.id)) {
      sendError(res, 409, "CONFLICT", `A plan with id '${parsed.data.id}' already exists`);
      return;
    }
    await putPlan(parsed.data);
    res.status(201).json({ plan: parsed.data });
  }),
);

adminApiRouter.put(
  "/api/plans/:id",
  adminAuth,
  requireMinRole("manager"),
  handler(async (req, res) => {
    const parsed = parsePlanInput(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", formatIssues(parsed.error));
      return;
    }
    if (parsed.data.id !== String(req.params.id)) {
      sendError(res, 400, "INVALID_ARGS", "Plan id in the body must match the URL");
      return;
    }
    await putPlan(parsed.data);
    res.json({ plan: parsed.data });
  }),
);

adminApiRouter.delete(
  "/api/plans/:id",
  adminAuth,
  requireMinRole("manager"),
  handler(async (req, res) => {
    const removed = await deletePlan(String(req.params.id));
    if (removed === 0) {
      sendError(res, 404, "NOT_FOUND", `No such plan '${String(req.params.id)}'`);
      return;
    }
    res.json({ ok: true });
  }),
);

/**
 * Estate-wide totals for the subscriptions page's stat tiles, so the table below
 * them can page normally instead of the browser pulling the whole catalog.
 */
adminApiRouter.get(
  "/api/subscriptions/summary",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (_req, res) => {
    try {
      res.json(await getSubscriptionSummary());
    } catch (err) {
      if (err instanceof SubscriptionStoreUnavailableError) {
        sendError(res, 503, "PROVIDER_UNAVAILABLE", "Billing store unavailable");
        return;
      }
      throw err;
    }
  }),
);

adminApiRouter.get(
  "/api/subscriptions",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (req, res) => {
    try {
      // The derived status rides along — see `toEffectiveSubscription`. Without it
      // the console renders a lapsed trial as "trialing" while the API refuses it.
      const subs = (await listSubscriptions()).map((sub) => toEffectiveSubscription(sub));
      res.json(paginate(subs, pageParams(req.query)));
    } catch (err) {
      if (err instanceof SubscriptionStoreUnavailableError) {
        sendError(res, 503, "PROVIDER_UNAVAILABLE", "Billing store unavailable");
        return;
      }
      throw err;
    }
  }),
);

adminApiRouter.get(
  "/api/tenants/:tenantId/subscription",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (req, res) => {
    try {
      const stored = await resolveSubscription(String(req.params.tenantId));
      const subscription = stored ? toEffectiveSubscription(stored) : stored;
      res.json({ subscription: subscription ?? null });
    } catch (err) {
      if (err instanceof SubscriptionStoreUnavailableError) {
        sendError(res, 503, "PROVIDER_UNAVAILABLE", "Billing store unavailable");
        return;
      }
      throw err;
    }
  }),
);

adminApiRouter.put(
  "/api/tenants/:tenantId/subscription",
  adminAuth,
  requireMinRole("manager"),
  handler(async (req, res) => {
    const parsed = assignSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", "planId is required");
      return;
    }
    // A subscription may only be set from a plan that exists in the catalog.
    const decision = assignablePlan(parsed.data.planId, await getStoredPlan(parsed.data.planId));
    if (!decision.ok) {
      sendError(res, 404, "NOT_FOUND", decision.reason);
      return;
    }
    const tenantId = String(req.params.tenantId);
    const subscription = createSubscriptionFromPlan(tenantId, decision.plan);
    await putSubscription(subscription);
    await recordAuditEvent({
      action: "subscription.assigned",
      actor: req.admin!.userId,
      actorLabel: req.admin!.label,
      target: tenantId,
      targetLabel: tenantId,
      metadata: { planId: decision.plan.id, planName: decision.plan.name },
    });
    res.json({ subscription });
  }),
);

// ── Observability (viewer+) ───────────────────────────────────────────────────

adminApiRouter.get(
  "/api/functions",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (_req, res) => {
    res.json({ functions: listFunctions().map((d) => d.key) });
  }),
);

adminApiRouter.get(
  "/api/metrics/summary",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (_req, res) => {
    res.json(await getMetricsSummary());
  }),
);

adminApiRouter.get(
  "/api/usage",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (req, res) => {
    res.json(paginate(await getAllTenantUsage(), pageParams(req.query)));
  }),
);

adminApiRouter.get(
  "/api/queue",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (_req, res) => {
    res.json(await getQueueStats());
  }),
);

adminApiRouter.get(
  "/api/health",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (_req, res) => {
    // Same check the `/readyz` probe runs, so the console can't show green while
    // the load balancer is taking this instance out of rotation.
    const deps = await checkDependencies();
    res.json({
      status: deps.redis && deps.postgres ? "ok" : "degraded",
      ...deps,
      providers: providerStatus(),
      version: env.VERSION,
    });
  }),
);

// ── Audit trail (viewer+) ─────────────────────────────────────────────────────

adminApiRouter.get(
  "/api/audit",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (req, res) => {
    const params = pageParams(req.query);
    // Paged in SQL, not sliced here: audit_events is the one admin table with no
    // natural ceiling (see listAuditEventsPage).
    const { items, total } = await listAuditEventsPage({
      action: typeof req.query.action === "string" ? req.query.action : undefined,
      actor: typeof req.query.actor === "string" ? req.query.actor : undefined,
      ...params,
    });
    res.json(paginatedFrom(items, total, params));
  }),
);

// ── Logs (viewer+) — bounded Redis tail of recent structured log entries ───────

const LOG_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

adminApiRouter.get(
  "/api/logs",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (req, res) => {
    const level =
      typeof req.query.level === "string" && LOG_LEVELS.has(req.query.level as LogLevel)
        ? (req.query.level as LogLevel)
        : undefined;
    // The buffer is a capped ring (MAX_ENTRIES), so reading the filtered tail whole
    // and slicing it is bounded by construction; `limit` still trims the read.
    const limit = Number(req.query.limit);
    const entries = await recentLogs({ level, limit: Number.isFinite(limit) ? limit : undefined });
    res.json(paginate(entries, pageParams(req.query)));
  }),
);

// ── Platform settings (viewer read, manager write) ────────────────────────────
// notifications, API integrations, and general platform configuration all share
// the namespaced settings store; `security` is handled separately below so its GET
// can also surface live (env-derived) posture.

const settingsRoute = (path: string, namespace: Exclude<SettingsNamespace, "security">): void => {
  adminApiRouter.get(
    path,
    adminAuth,
    requireMinRole("viewer"),
    handler(async (_req, res) => {
      res.json({ settings: await getSettings(namespace) });
    }),
  );
  adminApiRouter.put(
    path,
    adminAuth,
    requireMinRole("manager"),
    handler(async (req, res) => {
      try {
        const settings = await putSettings(namespace, req.body);
        await recordAuditEvent({
          action: `settings.${namespace}.updated`,
          actor: req.admin!.userId,
          actorLabel: req.admin!.label,
        });
        res.json({ settings });
      } catch (err) {
        sendError(res, 400, "INVALID_ARGS", err instanceof Error ? err.message : "Invalid settings");
      }
    }),
  );
};

settingsRoute("/api/settings/notifications", "notifications");
settingsRoute("/api/settings/api-integrations", "api_integrations");
settingsRoute("/api/settings/platform", "platform");
settingsRoute("/api/settings/retention", "retention");

// ── Documents (viewer) ────────────────────────────────────────────────────────
// The platform-wide view of the same registry the portal shows per tenant. Only
// `standard`-sensitivity functions are ever recorded (src/observability/documents.ts).

adminApiRouter.get(
  "/api/documents",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (req, res) => {
    const params = pageParams(req.query);
    const { items, total } = await listDocumentsPage({
      ...params,
      tenantId: req.query.tenantId ? String(req.query.tenantId) : undefined,
      functionKey: req.query.functionKey ? String(req.query.functionKey) : undefined,
      outcome: req.query.outcome === "error" || req.query.outcome === "success" ? req.query.outcome : undefined,
    });
    res.json(paginatedFrom(items, total, params));
  }),
);

/**
 * Runs the retention sweep now instead of waiting for the worker's hourly tick.
 * Manager-only and audited: it destroys records, and an operator reaching for it is
 * usually acting on a just-shortened window.
 */
adminApiRouter.post(
  "/api/retention/sweep",
  adminAuth,
  requireMinRole("manager"),
  handler(async (req, res) => {
    const result = await runRetentionSweep();
    await recordAuditEvent({
      action: "retention.swept",
      actor: req.admin!.userId,
      actorLabel: req.admin!.label,
      metadata: { ...result, manual: true },
    });
    res.json(result);
  }),
);

// ── Security (viewer read, manager write) ─────────────────────────────────────
// GET returns editable settings plus a read-only posture snapshot derived from the
// running configuration, so the console can show the effective security stance.

adminApiRouter.get(
  "/api/security",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (_req, res) => {
    res.json({
      settings: await getSettings("security"),
      posture: {
        authEnabled: env.AUTH_ENABLED === "true",
        rateLimitEnabled: env.RATE_LIMIT_ENABLED === "true",
        rateLimitMax: env.RATE_LIMIT_MAX,
        rateLimitWindowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
        adminSessionTtlSeconds: env.ADMIN_SESSION_TTL_SECONDS,
        tenantSessionTtlSeconds: env.TENANT_SESSION_TTL_SECONDS,
        corsClosed: env.CORS_ALLOWED_ORIGINS.trim() === "",
      },
    });
  }),
);

adminApiRouter.put(
  "/api/security",
  adminAuth,
  requireMinRole("manager"),
  handler(async (req, res) => {
    try {
      const settings = await putSettings("security", req.body);
      await recordAuditEvent({
        action: "settings.security.updated",
        actor: req.admin!.userId,
        actorLabel: req.admin!.label,
      });
      res.json({ settings });
    } catch (err) {
      sendError(res, 400, "INVALID_ARGS", err instanceof Error ? err.message : "Invalid settings");
    }
  }),
);

// ── Configuration backup & restore (viewer read, manager write) ───────────────

const backupNoteSchema = z.object({ note: z.string().max(500).optional() });

adminApiRouter.get(
  "/api/backups",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (req, res) => {
    res.json(paginate(await listBackups(), pageParams(req.query)));
  }),
);

adminApiRouter.post(
  "/api/backups",
  adminAuth,
  requireMinRole("manager"),
  handler(async (req, res) => {
    const parsed = backupNoteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", "Invalid note");
      return;
    }
    const manifest = await createBackup({ actor: req.admin!.userId, note: parsed.data.note });
    await recordAuditEvent({
      action: "backup.created",
      actor: req.admin!.userId,
      actorLabel: req.admin!.label,
      target: manifest.id,
      targetLabel: parsed.data.note || `Backup ${manifest.id.slice(0, 8)}`,
    });
    res.status(201).json({ backup: manifest });
  }),
);

adminApiRouter.get(
  "/api/backups/:id",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (req, res) => {
    const backup = await getBackup(String(req.params.id));
    if (!backup) {
      sendError(res, 404, "NOT_FOUND", "No such backup");
      return;
    }
    res.json(backup);
  }),
);

adminApiRouter.post(
  "/api/backups/:id/restore",
  adminAuth,
  requireMinRole("manager"),
  handler(async (req, res) => {
    const id = String(req.params.id);
    const applied = await restoreBackup(id);
    if (!applied) {
      sendError(res, 404, "NOT_FOUND", "No such backup");
      return;
    }
    await recordAuditEvent({
      action: "backup.restored",
      actor: req.admin!.userId,
      actorLabel: req.admin!.label,
      target: id,
      targetLabel: `Backup ${id.slice(0, 8)}`,
    });
    res.json({ applied });
  }),
);
