import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { http, unwrap, type Paginated, type PaginatedParams } from "@heirs/api-client";
import { invalidate, tenantInvalidations, tenantKeys } from "./query-keys";
import type { TenantApiKey } from "@/types/user";

/** The signed-in tenant's API keys (owner only). */
export function useTenantKeys(params?: PaginatedParams) {
  return useQuery({
    queryKey: tenantKeys.keyList(params),
    queryFn: () => http.get<Paginated<TenantApiKey>>("/api/tenant/keys", params).then(unwrap),
    retry: false,
  });
}

/** Creates a key; the raw secret is returned exactly once (shown then discarded). */
export function useCreateTenantKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "keys", "create"],
    mutationFn: (payload: { name?: string; expiresAt?: string }) =>
      http.post<TenantApiKey & { apiKey: string }>("/api/tenant/keys", payload).then(unwrap),
    onSuccess: () => invalidate(qc, tenantInvalidations.keys),
  });
}

export function useRevokeTenantKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "keys", "revoke"],
    mutationFn: (keyHash: string) => http.delete(`/api/tenant/keys/${keyHash}`).then(unwrap),
    onSuccess: () => invalidate(qc, tenantInvalidations.keys),
  });
}
