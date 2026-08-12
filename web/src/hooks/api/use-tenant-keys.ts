import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { http, unwrap } from "@/lib/client";
import type { TenantApiKey } from "@/types/user";

const KEYS = ["tenant", "keys"];

/** The signed-in tenant's API keys (owner only). */
export function useTenantKeys() {
  return useQuery({
    queryKey: KEYS,
    queryFn: () => http.get<{ keys: TenantApiKey[] }>("/api/tenant/keys").then(unwrap),
    retry: false,
  });
}

/** Creates a key; the raw secret is returned exactly once (shown then discarded). */
export function useCreateTenantKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "keys", "create"],
    mutationFn: (payload: { name?: string }) =>
      http.post<TenantApiKey & { apiKey: string }>("/api/tenant/keys", payload).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

export function useRevokeTenantKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "keys", "revoke"],
    mutationFn: (keyHash: string) => http.delete(`/api/tenant/keys/${keyHash}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}
