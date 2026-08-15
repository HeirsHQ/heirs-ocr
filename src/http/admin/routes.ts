import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";

import { clearLoginFailures, loginAllowed, recordLoginFailure } from "../../auth/login-throttle";
import { getSettings, putSettings, type SettingsNamespace } from "../../config/settings-store";
import { SESSION_COOKIE, createSession, destroySession } from "../../auth/admin-session";
import { deletePlan, getStoredPlan, listPlans, putPlan } from "../../billing/plan-store";
import { createBackup, getBackup, listBackups, restoreBackup } from "../../ops/backups";
import { adminAuth, parseCookies, requireMinRole } from "../middleware/admin-auth";
import { checkDependencies, providerStatus } from "../../observability/health";
import { listAuditEvents, recordAuditEvent } from "../../observability/audit";
import { createTenantUser, listTenantUsers } from "../../auth/tenant-users";
import { recentLogs, type LogLevel } from "../../observability/log-buffer";
import { getMetricsSummary } from "../../observability/metrics";
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
  listSubscriptions,
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
      session = await createSession(admin.id, admin.role);
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
  handler(async (_req, res) => {
    res.json({ admins: await listAdmins() });
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
    try {
      const admin = await createAdmin(parsed.data, req.admin!.userId);
      await recordAuditEvent({
        action: "admin.created",
        actor: req.admin!.userId,
        target: admin.id,
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
      target: id,
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
    await recordAuditEvent({ action: "admin.deleted", actor: req.admin!.userId, target: id });
    res.json({ ok: true });
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
  handler(async (_req, res) => {
    res.json({ tenants: await listTenants() });
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
      resolveSubscription(tenantId).catch(() => undefined),
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
    const tenant: Tenant = { ...parsed.data, createdAt: new Date().toISOString() };
    const apiKey = generateApiKey();
    await putTenant(apiKey, tenant, { actor: req.admin!.userId });
    await recordAuditEvent({ action: "tenant.created", actor: req.admin!.userId, target: tenant.tenantId });
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
      target: updated.tenantId,
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
    const removed = await revokeByHash(keyHash, { actor: req.admin!.userId });
    if (removed === 0) {
      sendError(res, 404, "NOT_FOUND", "No such tenant");
      return;
    }
    await recordAuditEvent({ action: "tenant.revoked", actor: req.admin!.userId, target: keyHash });
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
    res.json({ users: await listTenantUsers(String(req.params.tenantId)) });
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
  handler(async (_req, res) => {
    res.json({ plans: await listPlans() });
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

adminApiRouter.get(
  "/api/subscriptions",
  adminAuth,
  requireMinRole("viewer"),
  handler(async (_req, res) => {
    try {
      res.json({ subscriptions: await listSubscriptions() });
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
      const subscription = await resolveSubscription(String(req.params.tenantId));
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
      target: tenantId,
      metadata: { planId: decision.plan.id },
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
  handler(async (_req, res) => {
    res.json({ usage: await getAllTenantUsage() });
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
    const limit = Number(req.query.limit);
    const events = await listAuditEvents({
      action: typeof req.query.action === "string" ? req.query.action : undefined,
      actor: typeof req.query.actor === "string" ? req.query.actor : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json({ events });
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
    const limit = Number(req.query.limit);
    const entries = await recentLogs({ level, limit: Number.isFinite(limit) ? limit : undefined });
    res.json({ entries });
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
        await recordAuditEvent({ action: `settings.${namespace}.updated`, actor: req.admin!.userId });
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
      await recordAuditEvent({ action: "settings.security.updated", actor: req.admin!.userId });
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
  handler(async (_req, res) => {
    res.json({ backups: await listBackups() });
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
    await recordAuditEvent({ action: "backup.created", actor: req.admin!.userId, target: manifest.id });
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
    await recordAuditEvent({ action: "backup.restored", actor: req.admin!.userId, target: id });
    res.json({ applied });
  }),
);
