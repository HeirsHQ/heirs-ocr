import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";

import { SESSION_COOKIE, createSession, destroySession } from "../../auth/tenant-session";
import { clearLoginFailures, loginAllowed, recordLoginFailure } from "../../auth/login-throttle";
import { parseCookies } from "../middleware/admin-auth";
import { requireTenantRole, tenantAuth } from "../middleware/tenant-auth";
import { logger } from "../../observability/logger";
import type { TenantUser } from "../../types/user";
import {
  countOwners,
  createTenantUser,
  deleteTenantUser,
  getTenantUserByEmail,
  getTenantUserById,
  listTenantUsers,
  updateTenantUser,
  verifyPassword,
} from "../../auth/tenant-users";
import { generateApiKey, hashApiKey, listKeysForTenant, putTenant, revokeByHash } from "../../auth/tenants";

/**
 * Tenant portal JSON API, mounted under `/tenant` (paths here start with `/api`).
 * The tenant-side twin of the admin console (src/http/admin/routes.ts):
 * `POST /api/login` is the only open route; everything else requires a session
 * (`tenantAuth`) and, for management, `owner` role (`requireTenantRole`).
 *
 * Every route is scoped to the caller's own tenant org (`req.tenantUser.tenantId`) —
 * a tenant can never read or mutate another org's keys or users.
 */
export const tenantApiRouter = Router();

const TENANT_ROLE = z.enum(["owner", "member"]);

const sendError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ error: { code, message } });
};

/** Wraps an async handler so a thrown error becomes a 500 JSON instead of a hang. */
const handler =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch((err) => {
      logger.error("tenant route failed", { path: req.path, err: err instanceof Error ? err.message : String(err) });
      if (res.headersSent) {
        next(err);
        return;
      }
      sendError(res, 500, "INTERNAL", "Unexpected error");
    });
  };

/** See the admin console's note: `secure` from the actual request scheme, not NODE_ENV. */
const isHttpsRequest = (req: Request): boolean =>
  req.secure || (req.get("x-forwarded-proto") ?? "").split(",")[0]!.trim().toLowerCase() === "https";

/**
 * httpOnly session cookie for the portal. Scoped to `Path=/` (not `/tenant`) because
 * the same session also authenticates in-app OCR at `/v1/ocr/*` — the OCR auth
 * middleware reads this cookie when no API key is present.
 */
const setSessionCookie = (req: Request, res: Response, token: string, ttlSeconds: number): void => {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttpsRequest(req),
    path: "/",
    maxAge: ttlSeconds * 1000,
  });
};

// ── Auth ────────────────────────────────────────────────────────────────────

const loginSchema = z.object({ email: z.string().min(1), password: z.string().min(1) });

tenantApiRouter.post(
  "/api/login",
  handler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", "email and password are required");
      return;
    }

    const ip = req.ip ?? "unknown";
    const email = parsed.data.email;

    // Brute-force throttle, scoped to the tenant surface so it can't lock out admins.
    if (!(await loginAllowed("tenant", ip, email))) {
      logger.warn("tenant.login.throttled", { email, ip });
      sendError(res, 429, "RATE_LIMITED", "Too many failed attempts. Try again later.");
      return;
    }

    let user, session;
    try {
      user = await getTenantUserByEmail(email);
      // Same response whether the email is unknown or the password is wrong.
      if (!user || !(await verifyPassword(user, parsed.data.password))) {
        await recordLoginFailure("tenant", ip, email);
        logger.warn("tenant.login.failed", { email, ip });
        sendError(res, 401, "UNAUTHORIZED", "Invalid email or password");
        return;
      }
      session = await createSession(user.id, user.tenantId, user.role);
    } catch (err) {
      logger.error("tenant login: store unavailable", { err: err instanceof Error ? err.message : String(err) });
      sendError(res, 503, "PROVIDER_UNAVAILABLE", "Authentication store unavailable");
      return;
    }

    await clearLoginFailures("tenant", ip, email);
    setSessionCookie(req, res, session.token, session.ttl);
    logger.info("tenant.login", { userId: user.id, tenantId: user.tenantId, email: user.email, ip });
    res.json({ user: publicUser(user), tenantId: user.tenantId, role: user.role });
  }),
);

tenantApiRouter.post(
  "/api/logout",
  tenantAuth,
  handler(async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await destroySession(token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  }),
);

tenantApiRouter.get(
  "/api/me",
  tenantAuth,
  handler(async (req, res) => {
    const user = await getTenantUserById(req.tenantUser!.userId);
    if (!user) {
      sendError(res, 401, "UNAUTHORIZED", "Account no longer exists");
      return;
    }
    res.json({ user: publicUser(user), tenantId: user.tenantId, role: user.role });
  }),
);

/** Trims a stored user down to the public view — never leak the password hash. */
const publicUser = (u: TenantUser): TenantUser => ({
  id: u.id,
  tenantId: u.tenantId,
  email: u.email,
  name: u.name,
  role: u.role,
  disabled: u.disabled,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

// ── API keys (owner only) ─────────────────────────────────────────────────────
// The tenant's own keys for direct API access. The raw key is unrecoverable, so the
// list surfaces only the key-hash (and a short display prefix), never the secret.

const createKeySchema = z.object({ name: z.string().min(1).optional() });

/** Public shape of a key: the hash identifies it; the raw key is never stored. */
const publicKey = (keyHash: string, tenant: { name?: string; disabled?: boolean; createdAt?: string }) => ({
  keyHash,
  prefix: keyHash.slice(0, 12),
  name: tenant.name,
  disabled: tenant.disabled ?? false,
  createdAt: tenant.createdAt,
});

tenantApiRouter.get(
  "/api/keys",
  tenantAuth,
  requireTenantRole("owner"),
  handler(async (req, res) => {
    const keys = await listKeysForTenant(req.tenantUser!.tenantId);
    res.json({ keys: keys.map(({ keyHash, tenant }) => publicKey(keyHash, tenant)) });
  }),
);

tenantApiRouter.post(
  "/api/keys",
  tenantAuth,
  requireTenantRole("owner"),
  handler(async (req, res) => {
    const parsed = createKeySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", parsed.error.issues[0]?.message ?? "Invalid key");
      return;
    }
    const tenantId = req.tenantUser!.tenantId;
    const apiKey = generateApiKey();
    const createdAt = new Date().toISOString();
    await putTenant(apiKey, { tenantId, name: parsed.data.name, createdAt }, { actor: req.tenantUser!.userId });
    // The raw key is shown exactly once — it is never stored, only its hash.
    res.status(201).json({ apiKey, ...publicKey(hashApiKey(apiKey), { name: parsed.data.name, createdAt }) });
  }),
);

tenantApiRouter.delete(
  "/api/keys/:hash",
  tenantAuth,
  requireTenantRole("owner"),
  handler(async (req, res) => {
    const keyHash = String(req.params.hash);
    // Only revoke a key that belongs to this org — never touch another tenant's key.
    const owned = await listKeysForTenant(req.tenantUser!.tenantId);
    if (!owned.some((k) => k.keyHash === keyHash)) {
      sendError(res, 404, "NOT_FOUND", "No such key");
      return;
    }
    await revokeByHash(keyHash, { actor: req.tenantUser!.userId });
    res.json({ ok: true });
  }),
);

// ── Team / tenant users (owner only) ──────────────────────────────────────────

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: TENANT_ROLE,
  password: z.string().min(8),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: TENANT_ROLE.optional(),
  disabled: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

tenantApiRouter.get(
  "/api/users",
  tenantAuth,
  requireTenantRole("owner"),
  handler(async (req, res) => {
    res.json({ users: await listTenantUsers(req.tenantUser!.tenantId) });
  }),
);

tenantApiRouter.post(
  "/api/users",
  tenantAuth,
  requireTenantRole("owner"),
  handler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", parsed.error.issues[0]?.message ?? "Invalid user");
      return;
    }
    try {
      const user = await createTenantUser(
        { tenantId: req.tenantUser!.tenantId, ...parsed.data },
        req.tenantUser!.userId,
      );
      res.status(201).json({ user });
    } catch (err) {
      sendError(res, 409, "CONFLICT", err instanceof Error ? err.message : "Could not create user");
    }
  }),
);

tenantApiRouter.patch(
  "/api/users/:id",
  tenantAuth,
  requireTenantRole("owner"),
  handler(async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "INVALID_ARGS", parsed.error.issues[0]?.message ?? "Invalid update");
      return;
    }
    const tenantId = req.tenantUser!.tenantId;
    const id = String(req.params.id);
    const target = await getTenantUserById(id);
    if (!target || target.tenantId !== tenantId) {
      sendError(res, 404, "NOT_FOUND", "No such user");
      return;
    }

    // Self-lockout guard: don't let the last active owner be demoted or disabled.
    const removesOwner =
      target.role === "owner" && ((parsed.data.role && parsed.data.role !== "owner") || parsed.data.disabled === true);
    if (removesOwner && (await countOwners(tenantId)) <= 1) {
      sendError(res, 400, "LAST_OWNER", "Cannot demote or disable the last owner");
      return;
    }

    const user = await updateTenantUser(tenantId, id, parsed.data, req.tenantUser!.userId);
    res.json({ user });
  }),
);

tenantApiRouter.delete(
  "/api/users/:id",
  tenantAuth,
  requireTenantRole("owner"),
  handler(async (req, res) => {
    const tenantId = req.tenantUser!.tenantId;
    const id = String(req.params.id);
    const target = await getTenantUserById(id);
    if (!target || target.tenantId !== tenantId) {
      sendError(res, 404, "NOT_FOUND", "No such user");
      return;
    }
    if (target.role === "owner" && (await countOwners(tenantId)) <= 1) {
      sendError(res, 400, "LAST_OWNER", "Cannot delete the last owner");
      return;
    }
    await deleteTenantUser(tenantId, id, req.tenantUser!.userId);
    res.json({ ok: true });
  }),
);
