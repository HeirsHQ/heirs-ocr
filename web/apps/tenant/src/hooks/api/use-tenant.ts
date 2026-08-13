import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { removeNullOrUndefined } from "@heirs/ui";
import { PaginatedParams } from "@/types/app";
import { http, unwrap } from "@heirs/api-client";

export function useTenants(params?: PaginatedParams) {
  const _params = removeNullOrUndefined(params);

  return useQuery({
    queryKey: ["tenants", _params],
    queryFn: () => http.get("/api/tenants", _params).then(unwrap),
  });
}

export function useTenant(id: string) {
  return useQuery({
    queryKey: ["tenants", id],
    queryFn: () => http.get(`/api/tenants/${id}`).then(unwrap),
    enabled: !!id,
  });
}

export function useCreateTenant() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["create-tenant"],
    mutationFn: (payload: FormData) => http.post(`/api/tenants`, payload).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenants"] }),
    onError: (error) => console.log(error),
  });
}

export function useUpdateTenant() {}

export function useDeleteTenant() {}
