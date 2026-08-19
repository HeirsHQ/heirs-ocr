import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  http,
  unwrap,
  type ActiveSession,
  type TenantIpAllowlist,
  type MfaConfirmation,
  type MfaEnrolment,
  type MfaStatus,
} from "@heirs/api-client";
import { invalidate, tenantInvalidations, tenantKeys } from "./query-keys";

/**
 * Second-factor management for the signed-in tenant user, through the tenant BFF
 * proxy. The mirror of the console's `use-admin-security.ts`.
 *
 * Disabling MFA and re-minting recovery codes both re-check the password: the
 * backend requires it because a hijacked session must not be able to strip the
 * account back to one factor.
 */

export function useTenantMfaStatus() {
  return useQuery({
    queryKey: tenantKeys.mfa,
    queryFn: () => http.get<MfaStatus>("/api/tenant/security/mfa").then(unwrap),
    staleTime: 30_000,
  });
}

/** Phase one: mints a pending secret. Enrolment is not live until it is confirmed. */
export function useTenantMfaBegin() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["tenant-security", "mfa", "begin"],
    mutationFn: () => http.post<MfaEnrolment>("/api/tenant/security/mfa", {}).then(unwrap),
    // Begin stores an unconfirmed secret, which flips the status to `pending` — a
    // real change, so the status query must not keep serving the pre-enrolment value.
    onSuccess: () => invalidate(qc, tenantInvalidations.security),
  });
}

/** Phase two: the code proves the authenticator holds the secret; returns the codes. */
export function useTenantMfaConfirm() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["tenant-security", "mfa", "confirm"],
    mutationFn: (code: string) => http.post<MfaConfirmation>("/api/tenant/security/mfa/verify", { code }).then(unwrap),
    onSuccess: () => invalidate(qc, tenantInvalidations.security),
  });
}

export function useTenantMfaDisable() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["tenant-security", "mfa", "disable"],
    // The password rides in the body, so this is `delete` with data, not a query param.
    mutationFn: (password: string) => http.delete("/api/tenant/security/mfa", { data: { password } }).then(unwrap),
    onSuccess: () => invalidate(qc, tenantInvalidations.security),
  });
}

export function useTenantMfaRecoveryCodes() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["tenant-security", "mfa", "recovery-codes"],
    mutationFn: (password: string) =>
      http.post<{ recoveryCodes: string[] }>("/api/tenant/security/mfa/recovery-codes", { password }).then(unwrap),
    onSuccess: () => invalidate(qc, tenantInvalidations.security),
  });
}

// ── Active sessions ───────────────────────────────────────────────────────────

export function useTenantSessions() {
  return useQuery({
    queryKey: tenantKeys.sessions,
    queryFn: () => http.get<{ sessions: ActiveSession[] }>("/api/tenant/security/sessions").then(unwrap),
    // Short, because the interesting case is "I just signed in elsewhere and want to
    // see it" — a long cache makes the list look wrong at exactly that moment.
    staleTime: 10_000,
  });
}

export function useRevokeTenantSessions() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["tenant-security", "sessions", "revoke"],
    mutationFn: () => http.delete<{ revoked: number }>("/api/tenant/security/sessions").then(unwrap),
    onSuccess: () => invalidate(qc, [tenantKeys.sessions]),
  });
}

// ── IP allowlist (owner only) ─────────────────────────────────────────────────

export function useTenantIpAllowlist() {
  return useQuery({
    queryKey: tenantKeys.ipAllowlist,
    queryFn: () => http.get<TenantIpAllowlist>("/api/tenant/security/ip-allowlist").then(unwrap),
    retry: false,
  });
}

export function useSaveTenantIpAllowlist() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["tenant-security", "ip-allowlist", "save"],
    mutationFn: (payload: TenantIpAllowlist) =>
      http.put<TenantIpAllowlist>("/api/tenant/security/ip-allowlist", payload).then(unwrap),
    onSuccess: () => invalidate(qc, [tenantKeys.ipAllowlist]),
  });
}

// ── Password ──────────────────────────────────────────────────────────────────

export interface ChangePasswordPayload {
  current: string;
  next: string;
}

/**
 * Changes the signed-in user's password.
 *
 * The server revokes every other session as part of this, so the session list is
 * stale the moment it succeeds.
 */
export function useChangeTenantPassword() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["tenant-security", "password"],
    mutationFn: (payload: ChangePasswordPayload) =>
      http.post<{ ok: true; sessionsRevoked: number }>("/api/tenant/security/password", payload).then(unwrap),
    onSuccess: () => invalidate(qc, [tenantKeys.sessions]),
  });
}
