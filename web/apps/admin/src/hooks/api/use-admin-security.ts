import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  http,
  unwrap,
  type ActiveSession,
  type MfaConfirmation,
  type MfaEnrolment,
  type MfaStatus,
} from "@heirs/api-client";
import { adminInvalidations, adminKeys, invalidate } from "./query-keys";

/**
 * Second-factor management for the signed-in console user, through the admin BFF
 * proxy. The mirror of the portal's `use-tenant-security.ts`.
 *
 * Note this is the *operator's own* account, not the platform security settings on
 * the same page (`use-admin-console.ts`) — those are different endpoints entirely.
 */

export function useAdminMfaStatus() {
  return useQuery({
    queryKey: adminKeys.mfa,
    queryFn: () => http.get<MfaStatus>("/api/admin/security/mfa").then(unwrap),
    staleTime: 30_000,
  });
}

/** Phase one: mints a pending secret. Enrolment is not live until it is confirmed. */
export function useAdminMfaBegin() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["admin-security", "mfa", "begin"],
    mutationFn: () => http.post<MfaEnrolment>("/api/admin/security/mfa", {}).then(unwrap),
    // Begin stores an unconfirmed secret, which flips the status to `pending` — a
    // real change, so the status query must not keep serving the pre-enrolment value.
    onSuccess: () => invalidate(qc, adminInvalidations.mfa),
  });
}

/** Phase two: the code proves the authenticator holds the secret; returns the codes. */
export function useAdminMfaConfirm() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["admin-security", "mfa", "confirm"],
    mutationFn: (code: string) => http.post<MfaConfirmation>("/api/admin/security/mfa/verify", { code }).then(unwrap),
    onSuccess: () => invalidate(qc, adminInvalidations.mfa),
  });
}

export function useAdminMfaDisable() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["admin-security", "mfa", "disable"],
    // The password rides in the body, so this is `delete` with data, not a query param.
    mutationFn: (password: string) => http.delete("/api/admin/security/mfa", { data: { password } }).then(unwrap),
    onSuccess: () => invalidate(qc, adminInvalidations.mfa),
  });
}

export function useAdminMfaRecoveryCodes() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["admin-security", "mfa", "recovery-codes"],
    mutationFn: (password: string) =>
      http.post<{ recoveryCodes: string[] }>("/api/admin/security/mfa/recovery-codes", { password }).then(unwrap),
    onSuccess: () => invalidate(qc, adminInvalidations.mfa),
  });
}

// ── Active sessions ───────────────────────────────────────────────────────────

export function useAdminSessions() {
  return useQuery({
    queryKey: adminKeys.sessions,
    queryFn: () => http.get<{ sessions: ActiveSession[] }>("/api/admin/security/sessions").then(unwrap),
    staleTime: 10_000,
  });
}

export function useRevokeAdminSessions() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["admin-security", "sessions", "revoke"],
    mutationFn: () => http.delete<{ revoked: number }>("/api/admin/security/sessions").then(unwrap),
    onSuccess: () => invalidate(qc, [adminKeys.sessions, adminKeys.audit]),
  });
}

// ── Password ──────────────────────────────────────────────────────────────────

export interface ChangePasswordPayload {
  current: string;
  next: string;
}

/** The console's twin of the portal's password change; also revokes other sessions. */
export function useChangeAdminPassword() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["admin-security", "password"],
    mutationFn: (payload: ChangePasswordPayload) =>
      http.post<{ ok: true; sessionsRevoked: number }>("/api/admin/security/password", payload).then(unwrap),
    onSuccess: () => invalidate(qc, [adminKeys.sessions, adminKeys.audit]),
  });
}
