import { z } from "zod";

import { matchesEntry } from "../auth/ip-allowlist";

import { logger } from "../observability/logger";
import { query } from "../db";

/**
 * Durable, admin-managed platform settings, backed by the `platform_settings`
 * table (src/db.ts). One row per namespace; the payload lives in a `jsonb` `data`
 * column. Each namespace has a Zod schema with defaults, so a missing row reads
 * back as the schema default rather than `undefined` — the console always has a
 * complete object to render and edit.
 *
 * This is the backing store for four admin-console areas that are all "settings":
 * notifications, API integrations, general platform configuration, and the
 * editable slice of security posture. Reads do **not** fail open — these are
 * admin-path concerns, so a store error propagates and the route wrapper turns it
 * into a 500 rather than silently serving stale defaults.
 */

// ── Per-namespace schemas ─────────────────────────────────────────────────────

const notificationChannel = z.object({
  id: z.string().min(1),
  type: z.enum(["email", "webhook"]),
  target: z.string().min(1),
  enabled: z.boolean().default(true),
});

export const notificationsSchema = z.object({
  channels: z.array(notificationChannel).default([]),
  events: z
    .object({
      jobFailed: z.boolean().default(true),
      quotaExceeded: z.boolean().default(true),
      tenantCreated: z.boolean().default(false),
      subscriptionChanged: z.boolean().default(false),
    })
    .prefault({}),
});

const integration = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["webhook", "slack", "s3"]),
  url: z.string().min(1),
  enabled: z.boolean().default(true),
  createdAt: z.string().min(1),
});

export const apiIntegrationsSchema = z.object({
  integrations: z.array(integration).default([]),
});

export const platformSchema = z.object({
  maintenanceMode: z.boolean().default(false),
  defaultTenantRateLimit: z.number().int().positive().default(60),
  supportEmail: z.string().default(""),
  featureFlags: z.record(z.string(), z.boolean()).default({}),
});

/**
 * One allowlist entry — a bare IP or a CIDR range.
 *
 * Validated on write rather than only on match. A malformed entry never matches
 * anything (see `matchesEntry`), so saving one into a non-empty list would deny every
 * sign-in — that is a lockout caused by a typo, and refusing the save is the only
 * point at which it can still be corrected easily.
 */
export const ipAllowlistEntry = z
  .string()
  .min(1)
  .refine((value) => matchesEntry(value.split("/")[0] ?? "", value), {
    message: "Must be a valid IP address or CIDR range, e.g. 203.0.113.0/24",
  });

export const securitySchema = z.object({
  enforceHttps: z.boolean().default(true),
  sessionIdleTimeoutMinutes: z.number().int().positive().default(60),
  passwordMinLength: z.number().int().min(8).max(128).default(8),
  /** Empty allows every address; that is the unconfigured state, not "deny all". */
  ipAllowlist: z.array(ipAllowlistEntry).default([]),
});

/**
 * How long processed-document records and audit events are kept.
 *
 * The sweep (src/jobs/retention.ts) reads this every run and deletes by age, so
 * shortening a window applies to rows already stored rather than only to new ones.
 * `enabled: false` suspends the sweep entirely — an escape hatch for an operator who
 * needs to preserve everything during an investigation.
 */
export const retentionSchema = z.object({
  enabled: z.boolean().default(true),
  documentRetentionDays: z.number().int().min(1).max(3650).default(90),
  // Longer than documents by default: the audit trail is the record of who changed
  // what, which is exactly what a post-incident review needs to reach back into.
  auditRetentionDays: z.number().int().min(1).max(3650).default(365),
});

/** Registry of every settings namespace with its schema. */
export const SETTINGS_SCHEMAS = {
  notifications: notificationsSchema,
  api_integrations: apiIntegrationsSchema,
  platform: platformSchema,
  security: securitySchema,
  retention: retentionSchema,
} as const;

export type SettingsNamespace = keyof typeof SETTINGS_SCHEMAS;
export type SettingsOf<N extends SettingsNamespace> = z.infer<(typeof SETTINGS_SCHEMAS)[N]>;

/** The schema default for a namespace (parses `{}`, filling every field). */
const defaultsFor = <N extends SettingsNamespace>(ns: N): SettingsOf<N> =>
  SETTINGS_SCHEMAS[ns].parse({}) as SettingsOf<N>;

type SettingsRow = { data: unknown; updated_at: Date };

/**
 * Read a namespace's settings. Missing row ⇒ schema defaults. A stored payload is
 * re-parsed through the schema so a field added to the schema after the row was
 * written still reads back with its default.
 */
export const getSettings = async <N extends SettingsNamespace>(ns: N): Promise<SettingsOf<N>> => {
  const { rows } = await query<SettingsRow>(`SELECT data, updated_at FROM platform_settings WHERE namespace = $1`, [
    ns,
  ]);
  if (!rows[0]) return defaultsFor(ns);
  const parsed = SETTINGS_SCHEMAS[ns].safeParse(rows[0].data);
  return (parsed.success ? parsed.data : defaultsFor(ns)) as SettingsOf<N>;
};

/** Validate and upsert a namespace's settings; returns the stored (parsed) value. */
export const putSettings = async <N extends SettingsNamespace>(ns: N, input: unknown): Promise<SettingsOf<N>> => {
  const value = SETTINGS_SCHEMAS[ns].parse(input) as SettingsOf<N>;
  await query(
    `INSERT INTO platform_settings (namespace, data, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (namespace) DO UPDATE SET data = excluded.data, updated_at = now()`,
    [ns, JSON.stringify(value)],
  );
  logger.info("settings.updated", { namespace: ns });
  return value;
};
