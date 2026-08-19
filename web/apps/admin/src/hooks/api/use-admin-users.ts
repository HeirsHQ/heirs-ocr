import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AdminRole, AdminUser } from "@/types/user";
import { http, unwrap, type Paginated, type PaginatedParams } from "@heirs/api-client";
import { adminInvalidations, adminKeys, invalidate } from "./query-keys";

/**
 * Admin-console user management, via the admin BFF proxy (`/api/admin/*` → backend
 * `/admin/api/*`). Owner-only on the backend; the last-owner guard (can't demote,
 * disable, or delete the final owner) is enforced server-side and surfaced here.
 */

export function useAdminUsers(params?: PaginatedParams) {
  return useQuery({
    queryKey: adminKeys.adminList(params),
    queryFn: () => http.get<Paginated<AdminUser>>("/api/admin/admins", params).then(unwrap),
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
    onSuccess: () => invalidate(qc, adminInvalidations.admins),
  });
}

export function useUpdateAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "admins", "update"],
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAdminPayload }) =>
      http.patch<{ admin: AdminUser }>(`/api/admin/admins/${id}`, patch).then(unwrap),
    onSuccess: () => invalidate(qc, adminInvalidations.admins),
  });
}

export function useDeleteAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "admins", "delete"],
    mutationFn: (id: string) => http.delete(`/api/admin/admins/${id}`).then(unwrap),
    onSuccess: () => invalidate(qc, adminInvalidations.admins),
  });
}
