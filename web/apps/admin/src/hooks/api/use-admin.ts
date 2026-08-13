import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { removeNullOrUndefined } from "@heirs/ui";
import { PaginatedParams } from "@/types/app";
import { http, unwrap } from "@heirs/api-client";

export function useAdmins(params?: PaginatedParams) {
  const _params = removeNullOrUndefined(params);

  return useQuery({
    queryKey: ["users", _params],
    queryFn: () => http.get("/api/users", _params).then(unwrap),
  });
}

export function useAdmin(id: string) {
  return useQuery({
    queryKey: ["users", id],
    queryFn: () => http.get(`/api/users/${id}`).then(unwrap),
    enabled: !!id,
  });
}

export function useCreateAdmin() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["create-user"],
    mutationFn: (payload: FormData) => http.post(`/api/users`, payload).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (error) => console.log(error),
  });
}

export function useUpdateAdmin() {}

export function useDeleteAdmin() {}
