import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AdminTenant, AdminTenantDetail, SubscriptionView, TenantRecord } from "@/types/tenant";
import { http, unwrap } from "@heirs/api-client";
import type { TenantUser } from "@/types/user";

/**
 * Admin-console tenant provisioning, via the admin BFF proxy (`/api/admin/*` →
 * backend `/admin/api/*`). Covers the full bootstrap: create a tenant, seed its
 * first portal login, and assign a subscription plan.
 */

const TENANTS = ["admin", "tenants"];
const usersKey = (tenantId: string) => ["admin", "tenants", tenantId, "users"];
const subKey = (tenantId: string) => ["admin", "tenants", tenantId, "subscription"];

// ── Tenants ───────────────────────────────────────────────────────────────────

export function useTenants() {
  return useQuery({
    queryKey: TENANTS,
    queryFn: () => http.get<{ tenants: AdminTenant[] }>("/api/admin/tenants").then(unwrap),
    retry: false,
  });
}

export function useTenant(id: string) {
  return useQuery({
    queryKey: [...TENANTS, id],
    queryFn: () => http.get<AdminTenantDetail>(`/api/admin/tenants/${id}`).then(unwrap),
    enabled: !!id,
    retry: false,
  });
}

export interface CreateTenantPayload {
  tenantId: string;
  name?: string;
  rateLimit?: number;
  allowedFunctions?: string[];
  allowedOrigins?: string[];
}

/** Creates a tenant; the raw API key is returned exactly once (shown then discarded). */
export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "tenants", "create"],
    mutationFn: (payload: CreateTenantPayload) =>
      http.post<{ tenant: TenantRecord; apiKey: string }>("/api/admin/tenants", payload).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: TENANTS }),
  });
}

export interface OnboardTenantPayload {
  tenant: CreateTenantPayload;
  /** Optional first portal owner; without it the tenant is API-only until one is seeded. */
  owner?: SeedOwnerPayload;
  /** Optional plan to assign; without it the tenant runs on unlimited defaults. */
  planId?: string;
}

/**
 * Full tenant onboarding in one transaction: create the tenant, then (optionally) seed
 * its first owner login and assign a subscription. Returns the created tenant + its
 * one-time API key. Steps run in order; a later step failing surfaces its error while
 * the tenant already exists (finish the rest from the tenant's row).
 */
export function useOnboardTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "tenants", "onboard"],
    mutationFn: async (p: OnboardTenantPayload) => {
      const created = await http
        .post<{ tenant: TenantRecord; apiKey: string }>("/api/admin/tenants", p.tenant)
        .then(unwrap);
      const tenantId = created.tenant.tenantId;
      if (p.owner) {
        await http.post(`/api/admin/tenants/${tenantId}/users`, { role: "owner", ...p.owner }).then(unwrap);
      }
      if (p.planId) {
        await http.put(`/api/admin/tenants/${tenantId}/subscription`, { planId: p.planId }).then(unwrap);
      }
      return created;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TENANTS }),
  });
}

export type TenantPatch = Partial<
  Pick<TenantRecord, "name" | "rateLimit" | "disabled" | "allowedFunctions" | "allowedOrigins">
>;

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "tenants", "update"],
    mutationFn: ({ keyHash, patch }: { keyHash: string; patch: TenantPatch }) =>
      http.patch<{ tenant: TenantRecord }>(`/api/admin/tenants/${keyHash}`, patch).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: TENANTS }),
  });
}

/** Revokes the tenant's key (hard delete of the registry row). */
export function useDeleteTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "tenants", "delete"],
    mutationFn: (keyHash: string) => http.delete(`/api/admin/tenants/${keyHash}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: TENANTS }),
  });
}

// ── Portal login users (bootstrap the tenant portal) ──────────────────────────

export function useTenantLoginUsers(tenantId: string) {
  return useQuery({
    queryKey: usersKey(tenantId),
    queryFn: () => http.get<{ users: TenantUser[] }>(`/api/admin/tenants/${tenantId}/users`).then(unwrap),
    enabled: !!tenantId,
    retry: false,
  });
}

export interface SeedOwnerPayload {
  email: string;
  name: string;
  password: string;
}

/** Seeds a tenant's first owner login so the org can reach the portal. */
export function useSeedTenantOwner(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "tenants", tenantId, "users", "create"],
    mutationFn: (payload: SeedOwnerPayload) =>
      http
        .post<{ user: TenantUser }>(`/api/admin/tenants/${tenantId}/users`, { role: "owner", ...payload })
        .then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKey(tenantId) }),
  });
}

// ── Subscription ──────────────────────────────────────────────────────────────
// Plan-catalog reads/writes live in `use-admin-plans.ts`; the assignment dropdown
// there imports `usePlans`.

export function useTenantSubscription(tenantId: string) {
  return useQuery({
    queryKey: subKey(tenantId),
    queryFn: () =>
      http.get<{ subscription: SubscriptionView | null }>(`/api/admin/tenants/${tenantId}/subscription`).then(unwrap),
    enabled: !!tenantId,
    retry: false,
  });
}

export function useAssignSubscription(tenantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "tenants", tenantId, "subscription", "assign"],
    mutationFn: (planId: string) =>
      http
        .put<{ subscription: SubscriptionView }>(`/api/admin/tenants/${tenantId}/subscription`, { planId })
        .then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: subKey(tenantId) }),
  });
}
