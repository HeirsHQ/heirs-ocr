import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { http, unwrap } from "@/lib/client";
import type { AdminRole, AdminUser } from "@/types/user";

/**
 * Admin-console user management, via the admin BFF proxy (`/api/admin/*` → backend
 * `/admin/api/*`). Owner-only on the backend; the last-owner guard (can't demote,
 * disable, or delete the final owner) is enforced server-side and surfaced here.
 */

const ADMINS = ["admin", "admins"];

export function useAdminUsers() {
  return useQuery({
    queryKey: ADMINS,
    queryFn: () => http.get<{ admins: AdminUser[] }>("/api/admin/admins").then(unwrap),
    retry: false,
  });
}

export interface CreateAdminPayload {
  email: string;
  name: string;
  role: AdminRole;
  password: string;
}

export interface UpdateAdminPayload {
  name?: string;
  role?: AdminRole;
  disabled?: boolean;
  password?: string;
}

export function useCreateAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "admins", "create"],
    mutationFn: (payload: CreateAdminPayload) =>
      http.post<{ admin: AdminUser }>("/api/admin/admins", payload).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMINS }),
  });
}

export function useUpdateAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "admins", "update"],
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAdminPayload }) =>
      http.patch<{ admin: AdminUser }>(`/api/admin/admins/${id}`, patch).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMINS }),
  });
}

export function useDeleteAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "admins", "delete"],
    mutationFn: (id: string) => http.delete(`/api/admin/admins/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMINS }),
  });
}
