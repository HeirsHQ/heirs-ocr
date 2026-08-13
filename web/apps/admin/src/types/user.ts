export type AdminRole = "owner" | "manager" | "viewer";

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Shape of `GET /api/admin/me` and the `POST /api/admin/login` response. */
export interface AuthSession {
  user: User;
  role: AdminRole;
}

/** A console admin as surfaced by `GET /api/admin/admins`. */
export interface AdminUser extends User {
  role: AdminRole;
  disabled?: boolean;
}

export type TenantRole = "owner" | "member";

/** A tenant-portal user (belongs to a tenant org). */
export interface TenantUser extends User {
  tenantId: string;
  role: TenantRole;
  disabled?: boolean;
}

/** Shape of `GET /api/tenant/me` and the `POST /api/tenant/login` response. */
export interface TenantSession {
  user: User;
  tenantId: string;
  role: TenantRole;
}

/** A tenant API key as surfaced by `GET /api/tenant/keys` — never the raw secret. */
export interface TenantApiKey {
  keyHash: string;
  prefix: string;
  name?: string;
  disabled: boolean;
  createdAt?: string;
}
