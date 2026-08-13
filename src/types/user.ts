export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Admin console access tier (see docs/admin-console). Ordered least → most
 * privileged; `requireRole` compares against this ranking.
 *
 *   viewer  → read-only observability
 *   manager → viewer + tenant create/edit/revoke
 *   owner   → manager + admin-user management
 */
export type AdminRole = "owner" | "manager" | "viewer";

/**
 * Tenant-portal access tier. A tenant *org* is identified by `tenantId`; its users
 * log into the tenant portal to run OCR in-app and manage the org. Ordered
 * least → most privileged; `requireTenantRole` compares against this ranking.
 *
 *   member → run OCR in-app, view the org
 *   owner  → member + manage API keys and tenant users for the org
 */
export type TenantRole = "member" | "owner";

/** Public tenant-user shape (never the password hash), plus its org + role. */
export interface TenantUser extends User {
  tenantId: string;
  role: TenantRole;
  disabled?: boolean;
}
