/**
 * Human-readable phrasing for audit actions.
 *
 * The action key (`tenant.revoked`) is a stable identifier — it is what the API
 * filters on and what alerting matches, so it must not change to suit a UI. The
 * label is the sentence a person reads in the audit trail. Keeping them separate
 * means the wording can be improved without breaking a saved filter.
 *
 * Labels are resolved on read from this map rather than stored per row: actions are
 * a closed set defined in code, so storing the label would just be a copy that goes
 * stale the moment the wording is corrected. The *target* name is the opposite case
 * — it names a row that can be renamed or deleted, so it is snapshotted at write
 * time (see `actor_label` / `target_label` in src/db.ts).
 */
const ACTION_LABELS: Record<string, string> = {
  // Admin users
  "admin.created": "Created an admin user",
  "admin.updated": "Updated an admin user",
  "admin.deleted": "Deleted an admin user",
  "admin.mfa.enabled": "Enabled two-factor authentication",
  "admin.mfa.disabled": "Disabled two-factor authentication",
  "admin.mfa.recovery_codes_regenerated": "Regenerated two-factor recovery codes",
  "admin.mfa.reset": "Reset an admin's two-factor authentication",

  // Tenants
  "tenant.created": "Created a tenant",
  "tenant.updated": "Updated a tenant",
  "tenant.revoked": "Revoked a tenant API key",
  "tenant.mfa.enabled": "Enabled two-factor authentication",
  "tenant.mfa.disabled": "Disabled two-factor authentication",
  "tenant.mfa.recovery_codes_regenerated": "Regenerated two-factor recovery codes",
  "tenant.mfa.reset": "Reset a team member's two-factor authentication",

  // Billing
  "subscription.assigned": "Assigned a subscription plan",

  // Platform settings
  "settings.notifications.updated": "Updated notification settings",
  "settings.api_integrations.updated": "Updated API integrations",
  "settings.platform.updated": "Updated platform configuration",
  "settings.security.updated": "Updated security policy",
  "settings.retention.updated": "Updated retention policy",

  // Operations
  "backup.created": "Created a configuration backup",
  "backup.restored": "Restored a configuration backup",
  "retention.swept": "Ran the retention sweep",
};

/**
 * A readable sentence for an action key.
 *
 * Unmapped keys fall back to a humanised form of the key itself rather than to the
 * raw string: a new action added without a label still reads as words, so forgetting
 * to register one degrades the wording instead of leaking `foo.bar_baz` into the UI.
 */
export const actionLabel = (action: string): string => {
  const known = ACTION_LABELS[action];
  if (known) return known;

  const words = action.replace(/[._]/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : action;
};

/**
 * Formats a person as `Name (email)`, falling back to whichever part exists.
 *
 * Both are recorded because either alone is ambiguous in an audit trail: two staff
 * can share a display name, and an email alone is unreadable at a glance.
 */
export const personLabel = (person: { name?: string | null; email?: string | null }): string | undefined => {
  const name = person.name?.trim();
  const email = person.email?.trim();
  if (name && email) return `${name} (${email})`;
  return name || email || undefined;
};

/** Formats a tenant as `Name (id)`, or just the id when the org has no name set. */
export const tenantLabel = (tenant: { name?: string | null; tenantId: string }): string => {
  const name = tenant.name?.trim();
  return name ? `${name} (${tenant.tenantId})` : tenant.tenantId;
};
