import { randomUUID } from "crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

import type { AdminRole, User } from "../types/user";
import { getRedis, whenRedisReady } from "../redis";
import { logger } from "../observability/logger";
import { env } from "../config/env";

/**
 * Database-free admin-user registry — the operator-side twin of the tenant
 * registry (src/auth/tenants.ts). Admins log into the console at `/admin`; each
 * has a role (see {@link AdminRole}) that scopes what the API lets them do.
 *
 * Records live in a Redis hash `admins`, keyed by the user id, with a second hash
 * `admin_emails` mapping the (lowercased) login email → id. The password is stored
 * only as an **argon2id hash** — the plaintext is never persisted and there is no
 * way to recover it. Provisioning writes both hashes; deleting removes both.
 *
 * There is no relational database, so, as with tenants, the stdout log stream is
 * the audit trail (`admin.created` / `admin.updated` / `admin.deleted`).
 */
export const ADMINS_KEY = "admins";
export const ADMIN_EMAILS_KEY = "admin_emails";

/** The stored shape: the public {@link User}, plus the role and the secret hash. */
type AdminRecord = User & {
  role: AdminRole;
  passwordHash: string;
  /** When true the account can't log in, without being deleted (soft disable). */
  disabled?: boolean;
};

/** What the API is allowed to expose: the public user + role, never the hash. */
export type AdminView = User & { role: AdminRole; disabled?: boolean };

/** Login email is case-insensitive; normalize before every read/write. */
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Strips the secret before a record leaves this module. */
const toView = (record: AdminRecord): AdminView => {
  const { passwordHash: _passwordHash, ...view } = record;
  return view;
};

/**
 * Dates round-trip through Redis as ISO strings; JSON.parse leaves them as strings,
 * so revive them back into Date to honor the {@link User} contract.
 */
const parseRecord = (raw: string): AdminRecord => {
  const obj = JSON.parse(raw) as AdminRecord & { createdAt: string; updatedAt: string };
  return { ...obj, createdAt: new Date(obj.createdAt), updatedAt: new Date(obj.updatedAt) };
};

/**
 * argon2id with sensible interactive-login parameters. The library ships prebuilt
 * binaries (no native build), so this works on the slim runtime image as-is.
 */
const hashPassword = (plain: string): Promise<string> => argonHash(plain);

export type CreateAdminInput = {
  email: string;
  name: string;
  role: AdminRole;
  password: string;
};

/**
 * Creates an admin user. Rejects a duplicate email (the login key must be unique).
 * Returns the safe view; emits an `admin.created` audit line.
 */
export const createAdmin = async (input: CreateAdminInput, actor = "unknown"): Promise<AdminView> => {
  const email = normalizeEmail(input.email);
  const redis = getRedis();

  const existingId = await redis.hget(ADMIN_EMAILS_KEY, email);
  if (existingId) throw new Error(`An admin with email '${email}' already exists`);

  const now = new Date();
  const record: AdminRecord = {
    id: randomUUID(),
    email,
    name: input.name,
    role: input.role,
    passwordHash: await hashPassword(input.password),
    createdAt: now,
    updatedAt: now,
  };

  await redis.hset(ADMINS_KEY, record.id, JSON.stringify(record));
  await redis.hset(ADMIN_EMAILS_KEY, email, record.id);
  logger.info("admin.created", { adminId: record.id, email, role: record.role, actor });
  return toView(record);
};

/** Resolves a login email to its full record (secret included) or `undefined`. */
export const getAdminByEmail = async (email: string): Promise<AdminRecord | undefined> => {
  const redis = getRedis();
  const id = await redis.hget(ADMIN_EMAILS_KEY, normalizeEmail(email));
  if (!id) return undefined;
  const raw = await redis.hget(ADMINS_KEY, id);
  return raw ? parseRecord(raw) : undefined;
};

/** Resolves an id to its full record (secret included) or `undefined`. */
export const getAdminById = async (id: string): Promise<AdminRecord | undefined> => {
  const raw = await getRedis().hget(ADMINS_KEY, id);
  return raw ? parseRecord(raw) : undefined;
};

/** All admins as safe views, sorted oldest-first. */
export const listAdmins = async (): Promise<AdminView[]> => {
  const all = await getRedis().hgetall(ADMINS_KEY);
  return Object.values(all)
    .map((raw) => toView(parseRecord(raw)))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
};

/** Count of owner accounts — used to block removing the last one (self-lockout guard). */
export const countOwners = async (): Promise<number> => {
  const admins = await listAdmins();
  return admins.filter((a) => a.role === "owner" && !a.disabled).length;
};

/**
 * Seeds the first owner from `ADMIN_BOOTSTRAP_EMAIL`/`ADMIN_BOOTSTRAP_PASSWORD` when
 * the registry is **empty**, so the console is usable on a fresh deploy without any
 * out-of-band command. Idempotent and safe to call on every boot: once any admin
 * exists it does nothing, so it never overwrites a changed password or re-creates a
 * deleted account. Called from the web entrypoint (src/index.ts).
 */
export const ensureBootstrapAdmin = async (): Promise<void> => {
  // Wait for the connection to be writeable first — on a fresh boot against a
  // remote/TLS Redis the seed would otherwise fire before the socket is ready and
  // never land (it only retries on the next boot).
  await whenRedisReady();
  const existing = await getRedis().hlen(ADMINS_KEY);
  if (existing > 0) return;

  await createAdmin(
    {
      email: env.ADMIN_BOOTSTRAP_EMAIL,
      name: env.ADMIN_BOOTSTRAP_EMAIL.split("@")[0]!,
      role: "owner",
      password: env.ADMIN_BOOTSTRAP_PASSWORD,
    },
    "bootstrap",
  );
  logger.warn("admin bootstrap: seeded first owner — change the password after first login", {
    email: env.ADMIN_BOOTSTRAP_EMAIL,
  });
};

export type UpdateAdminInput = {
  name?: string;
  role?: AdminRole;
  disabled?: boolean;
  /** When present, resets the password to this new value (re-hashed). */
  password?: string;
};

/**
 * Updates an admin. Only the provided fields change; `password` is re-hashed.
 * Returns the safe view or `undefined` if no such admin. Emits `admin.updated`.
 */
export const updateAdmin = async (
  id: string,
  patch: UpdateAdminInput,
  actor = "unknown",
): Promise<AdminView | undefined> => {
  const current = await getAdminById(id);
  if (!current) return undefined;

  const next: AdminRecord = {
    ...current,
    name: patch.name ?? current.name,
    role: patch.role ?? current.role,
    disabled: patch.disabled ?? current.disabled,
    passwordHash: patch.password ? await hashPassword(patch.password) : current.passwordHash,
    updatedAt: new Date(),
  };

  await getRedis().hset(ADMINS_KEY, id, JSON.stringify(next));
  logger.info("admin.updated", {
    adminId: id,
    actor,
    role: next.role,
    disabled: next.disabled,
    passwordReset: !!patch.password,
  });
  return toView(next);
};

/** Deletes an admin (record + email index). Emits `admin.deleted`. Idempotent. */
export const deleteAdmin = async (id: string, actor = "unknown"): Promise<boolean> => {
  const current = await getAdminById(id);
  if (!current) return false;
  const redis = getRedis();
  await redis.hdel(ADMINS_KEY, id);
  await redis.hdel(ADMIN_EMAILS_KEY, current.email);
  logger.info("admin.deleted", { adminId: id, email: current.email, actor });
  return true;
};

/**
 * Verifies a plaintext password against a stored record. A disabled account always
 * fails, even with the right password. Returns false (never throws) on a malformed
 * hash so login stays constant-shaped.
 */
export const verifyPassword = async (record: AdminRecord, plain: string): Promise<boolean> => {
  if (record.disabled) return false;
  try {
    return await argonVerify(record.passwordHash, plain);
  } catch {
    return false;
  }
};
