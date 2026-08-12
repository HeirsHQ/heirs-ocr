import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { http, unwrap } from "@/lib/client";
import type { TenantSession } from "@/types/user";

export interface TenantLoginPayload {
  email: string;
  password: string;
}

const ME_KEY = ["tenant-auth", "me"];

/** Current tenant session, via the tenant BFF proxy. `null` when unauthenticated (401). */
export function useTenantMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<TenantSession | null> => {
      try {
        return await http.get<TenantSession>("/api/tenant/me").then(unwrap);
      } catch {
        return null;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useTenantLogin() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["tenant-auth", "login"],
    mutationFn: (payload: TenantLoginPayload) => http.post<TenantSession>("/api/tenant/login", payload).then(unwrap),
    onSuccess: (session) => qc.setQueryData(ME_KEY, session),
  });
}

export function useTenantLogout() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["tenant-auth", "logout"],
    mutationFn: () => http.post("/api/tenant/logout", {}).then(unwrap),
    onSuccess: () => qc.setQueryData(ME_KEY, null),
  });
}
