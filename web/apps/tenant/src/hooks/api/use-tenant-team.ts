import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { http, unwrap } from "@heirs/api-client";
import type { TenantRole, TenantUser } from "@/types/user";

const TEAM = ["tenant", "team"];

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
export function useTenantTeam() {
  return useQuery({
    queryKey: TEAM,
    queryFn: () => http.get<{ users: TenantUser[] }>("/api/tenant/users").then(unwrap),
    retry: false,
  });
}

export function useCreateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "team", "create"],
    mutationFn: (payload: CreateTeamMember) =>
      http.post<{ user: TenantUser }>("/api/tenant/users", payload).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAM }),
  });
}

export function useUpdateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "team", "update"],
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTeamMember }) =>
      http.patch<{ user: TenantUser }>(`/api/tenant/users/${id}`, patch).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAM }),
  });
}

export function useDeleteTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "team", "delete"],
    mutationFn: (id: string) => http.delete(`/api/tenant/users/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAM }),
  });
}
