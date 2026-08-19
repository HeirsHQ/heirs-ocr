import { z } from "zod";

import { ipAllowlistEntry } from "./settings-store";
import { logger } from "../observability/logger";
import { query } from "../db";

/**
 * Per-organisation settings, owned by the tenant rather than the platform operator.
 *
 * The twin of `platform_settings` (src/config/settings-store.ts), keyed by
 * `tenant_id` instead of a namespace. Separate table rather than a namespace on the
 * platform store because the access rules differ in kind: a tenant owner may edit
 * their own row and must never see another's, whereas platform settings are
 * operator-only. Keeping them apart means that boundary is enforced by the query,
 * not by remembering to filter.
 *
 * A missing row reads as schema defaults, so a tenant that has never opened the
 * security page behaves identically to one that saved the defaults explicitly.
 */

export const tenantSettingsSchema = z.object({
  /**
   * Restricts where a portal session may be *established*. Off by default: an
   * allowlist is a lockout risk, so it has to be turned on deliberately.
   */
  ipAllowlistEnabled: z.boolean().default(false),
  /** Entries are validated on write; a malformed one would deny every sign-in. */
  ipAllowlist: z.array(ipAllowlistEntry).default([]),
});

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

const defaults = (): TenantSettings => tenantSettingsSchema.parse({});

type Row = { data: unknown };

/**
 * A tenant's settings, or defaults when the row is missing or unreadable.
 *
 * Falls back to defaults on a parse failure rather than throwing: this is read on
 * the sign-in path, and a settings row that has drifted from the schema must not be
 * able to take the portal down. The failure is logged so it is still visible.
 */
export const getTenantSettings = async (tenantId: string): Promise<TenantSettings> => {
  const { rows } = await query<Row>(`SELECT data FROM tenant_settings WHERE tenant_id = $1`, [tenantId]);
  if (!rows[0]) return defaults();

  const parsed = tenantSettingsSchema.safeParse(rows[0].data);
  if (!parsed.success) {
    logger.warn("tenant settings failed to parse; using defaults", { tenantId });
    return defaults();
  }
  return parsed.data;
};

/** Validates and upserts a tenant's settings; returns the stored (parsed) value. */
export const putTenantSettings = async (tenantId: string, input: unknown): Promise<TenantSettings> => {
  const parsed = tenantSettingsSchema.parse(input);
  await query(
    `INSERT INTO tenant_settings (tenant_id, data, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (tenant_id) DO UPDATE SET data = excluded.data, updated_at = now()`,
    [tenantId, JSON.stringify(parsed)],
  );
  logger.info("tenant_settings.updated", { tenantId });
  return parsed;
};
