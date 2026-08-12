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
