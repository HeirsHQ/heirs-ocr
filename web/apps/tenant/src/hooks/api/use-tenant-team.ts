import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { http, unwrap, type Paginated, type PaginatedParams } from "@heirs/api-client";
import { invalidate, tenantInvalidations, tenantKeys } from "./query-keys";
import type { TenantRole, TenantUser } from "@/types/user";

export interface CreateTeamMember {
  email: string;
  name: string;
  role: TenantRole;
  password: string;
}

export interface UpdateTeamMember {
  name?: string;
  role?: TenantRole;
  disabled?: boolean;
  password?: string;
}

/** The signed-in tenant's users (owner only). */
export function useTenantTeam(params?: PaginatedParams) {
  return useQuery({
    queryKey: tenantKeys.teamList(params),
    queryFn: () => http.get<Paginated<TenantUser>>("/api/tenant/users", params).then(unwrap),
    retry: false,
  });
}

export function useCreateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "team", "create"],
    mutationFn: (payload: CreateTeamMember) =>
      http.post<{ user: TenantUser }>("/api/tenant/users", payload).then(unwrap),
    onSuccess: () => invalidate(qc, tenantInvalidations.team),
  });
}

export function useUpdateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "team", "update"],
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTeamMember }) =>
      http.patch<{ user: TenantUser }>(`/api/tenant/users/${id}`, patch).then(unwrap),
    onSuccess: () => invalidate(qc, tenantInvalidations.team),
  });
}

export function useDeleteTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "team", "delete"],
    mutationFn: (id: string) => http.delete(`/api/tenant/users/${id}`).then(unwrap),
    onSuccess: () => invalidate(qc, tenantInvalidations.team),
  });
}
