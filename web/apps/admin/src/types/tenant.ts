import type { TenantUsage } from "./metrics";

/**
 * Admin-console view types for tenant provisioning. Lean projections of the backend
 * registry (`src/auth/tenants.ts`) and billing model (`src/types/subscription.ts`) —
 * only the fields the console reads, not the full domain model.
 */

/** A tenant registry record. The raw API key is never returned — only its hash identifies it. */
export interface TenantRecord {
  tenantId: string;
  name?: string;
  disabled?: boolean;
  rateLimit?: number;
  allowedFunctions?: string[];
  allowedOrigins?: string[];
  createdAt?: string;
}

/** One row of `GET /api/admin/tenants`: the key hash (used to patch/revoke) plus its tenant. */
export interface AdminTenant {
  keyHash: string;
  tenant: TenantRecord;
}

/** A tenant's live subscription, trimmed to what the console displays. */
export interface SubscriptionView {
  id: string;
  status: string;
  plan: { id: string; name: string; tier: string };
}

export interface TenantUserView {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: "owner" | "member";
  disabled: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** Response shape of `GET /api/admin/tenants/:id`. */
export interface AdminTenantDetail {
  tenant: TenantRecord;
  keys: string[];
  users: TenantUserView[];
  subscription: SubscriptionView | null;
  plan: SubscriptionView["plan"] | null;
  /**
   * Lifetime counters from the `tenant_usage` rollup — every call the pipeline ran
   * for this tenant, with no time dimension and no expiry. Zeroed rather than absent
   * for a tenant that has never been called.
   *
   * These do not tie out against the tenant's charts, which read the request log: see
   * {@link import("./metrics").TenantFunctionUsage}.
   */
  usage: TenantUsage;
}
