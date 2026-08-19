import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { http, unwrap, type MfaChallengeRequired } from "@heirs/api-client";
import { adminKeys } from "./query-keys";
import type { AuthSession } from "@/types/user";

export interface LoginPayload {
  email: string;
  password: string;
}

/**
 * A password POST either signs the user in or stops at the second factor. The
 * union is deliberate: nothing may treat the MFA branch as a session, because on
 * that branch no cookie was set (see src/auth/mfa-challenge.ts on the backend).
 * Narrow it with `isMfaChallenge` from @heirs/api-client.
 */
export type LoginResult = AuthSession | MfaChallengeRequired;

export interface MfaLoginPayload {
  challenge: string;
  code: string;
}

const ME_KEY = adminKeys.me;

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
    mutationFn: (payload: LoginPayload) => http.post<LoginResult>("/api/admin/login", payload).then(unwrap),
    // Only seed the session cache on the branch that actually established one.
    onSuccess: (result) => {
      if (!("mfaRequired" in result)) qc.setQueryData(ME_KEY, result);
    },
  });
}

/** Redeems a login challenge for a real session with a TOTP or recovery code. */
export function useLoginMfa() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["auth", "login-mfa"],
    mutationFn: (payload: MfaLoginPayload) => http.post<AuthSession>("/api/admin/login/mfa", payload).then(unwrap),
    onSuccess: (session) => qc.setQueryData(ME_KEY, session),
  });
}

export function useLogout() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["auth", "logout"],
    mutationFn: () => http.post("/api/admin/logout", {}).then(unwrap),
    onSuccess: () => {
      // Drop every cached response, not just the session. The console's cache holds
      // tenants, usage, audit events and platform settings; leaving it means the next
      // operator to sign in on this browser sees the previous one's view from cache.
      qc.clear();
      qc.setQueryData(ME_KEY, null);
    },
  });
}
