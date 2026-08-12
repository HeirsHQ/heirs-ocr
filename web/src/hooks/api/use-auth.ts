import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { http, unwrap } from "@/lib/client";
import type { AuthSession } from "@/types/user";

export interface LoginPayload {
  email: string;
  password: string;
}

const ME_KEY = ["auth", "me"];

/** Current session, resolved via the admin BFF proxy. `null` when unauthenticated (401). */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<AuthSession | null> => {
      try {
        return await http.get<AuthSession>("/api/admin/me").then(unwrap);
      } catch {
        // A 401 is the normal "not logged in" case, not an error to surface.
        return null;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["auth", "login"],
    mutationFn: (payload: LoginPayload) => http.post<AuthSession>("/api/admin/login", payload).then(unwrap),
    onSuccess: (session) => qc.setQueryData(ME_KEY, session),
  });
}

export function useLogout() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["auth", "logout"],
    mutationFn: () => http.post("/api/admin/logout", {}).then(unwrap),
    onSuccess: () => qc.setQueryData(ME_KEY, null),
  });
}
