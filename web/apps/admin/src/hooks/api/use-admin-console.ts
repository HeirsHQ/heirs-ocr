import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { http, unwrap, type Paginated, type RetentionSettings } from "@heirs/api-client";
import { adminInvalidations, adminKeys, invalidate } from "./query-keys";
import { PaginatedParams } from "@/types";
import type {
  ApiIntegrationSettings,
  AuditEvent,
  BackupManifest,
  LogEntry,
  LogLevel,
  NotificationSettings,
  PlatformSettings,
  SecurityPosture,
  SecuritySettings,
} from "@/types/admin-console";
import { removeNullOrUndefined } from "@heirs/ui";

/**
 * Admin-console feature reads/writes (audit trail, logs, platform settings,
 * configuration backups), via the admin BFF proxy (`/api/admin/*` → backend
 * `/admin/api/*`). Reads are viewer+, writes manager+ server-side.
 */

// ── Audit trail ───────────────────────────────────────────────────────────────

export function useAuditEvents(filter: { action?: string; actor?: string } & PaginatedParams = {}) {
  return useQuery({
    queryKey: adminKeys.auditList(filter),
    queryFn: () => http.get<Paginated<AuditEvent>>("/api/admin/audit", filter).then(unwrap),
    retry: false,
    refetchInterval: 30_000,
  });
}

// ── Logs ──────────────────────────────────────────────────────────────────────

type LogParams = PaginatedParams & {
  level?: LogLevel | "all";
};

export function useLogs(params?: LogParams) {
  const _params = removeNullOrUndefined(params);

  return useQuery({
    queryKey: adminKeys.logList(_params),
    queryFn: () => http.get<Paginated<LogEntry>>("/api/admin/logs", _params).then(unwrap),
    retry: false,
    refetchInterval: 10_000,
  });
}

// ── Settings (generic read + write per namespace) ─────────────────────────────

function useSettings<T>(path: string, key: string) {
  return useQuery({
    queryKey: adminKeys.settingsNamespace(key),
    queryFn: () => http.get<{ settings: T }>(`/api/admin/settings/${path}`).then(unwrap),
    retry: false,
  });
}

function useSaveSettings<T>(path: string, key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "settings", key, "save"],
    mutationFn: (settings: T) => http.put<{ settings: T }>(`/api/admin/settings/${path}`, settings).then(unwrap),
    onSuccess: () => invalidate(qc, [adminKeys.settingsNamespace(key), ...adminInvalidations.settings]),
  });
}

export const useNotifications = () => useSettings<NotificationSettings>("notifications", "notifications");
export const useSaveNotifications = () => useSaveSettings<NotificationSettings>("notifications", "notifications");

export const useApiIntegrations = () => useSettings<ApiIntegrationSettings>("api-integrations", "api_integrations");
export const useSaveApiIntegrations = () =>
  useSaveSettings<ApiIntegrationSettings>("api-integrations", "api_integrations");

export const usePlatformSettings = () => useSettings<PlatformSettings>("platform", "platform");
export const useSavePlatformSettings = () => useSaveSettings<PlatformSettings>("platform", "platform");

export const useRetention = () => useSettings<RetentionSettings>("retention", "retention");
export const useSaveRetention = () => useSaveSettings<RetentionSettings>("retention", "retention");

/**
 * Runs the retention sweep now rather than waiting for the worker's hourly tick.
 * Reached from the settings panel right after a window is shortened, which is when
 * an operator wants to see the backlog actually go.
 */
export function useRunRetentionSweep() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "retention", "sweep"],
    mutationFn: () =>
      http
        .post<{ documents: number; auditEvents: number; skipped?: string }>("/api/admin/retention/sweep", {})
        .then(unwrap),
    onSuccess: () => invalidate(qc, adminInvalidations.retention),
  });
}

// ── Security (dedicated endpoint: settings + live posture) ────────────────────

export function useSecurity() {
  return useQuery({
    queryKey: adminKeys.security,
    queryFn: () =>
      http.get<{ settings: SecuritySettings; posture: SecurityPosture }>("/api/admin/security").then(unwrap),
    retry: false,
  });
}

export function useSaveSecurity() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "security", "save"],
    mutationFn: (settings: SecuritySettings) =>
      http.put<{ settings: SecuritySettings }>("/api/admin/security", settings).then(unwrap),
    onSuccess: () => invalidate(qc, adminInvalidations.security),
  });
}

// ── Backups ───────────────────────────────────────────────────────────────────

export function useBackups(params?: PaginatedParams) {
  return useQuery({
    queryKey: adminKeys.backupList(params),
    queryFn: () => http.get<Paginated<BackupManifest>>("/api/admin/backups", params).then(unwrap),
    retry: false,
  });
}

export function useCreateBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "backups", "create"],
    mutationFn: (note?: string) => http.post<{ backup: BackupManifest }>("/api/admin/backups", { note }).then(unwrap),
    onSuccess: () => invalidate(qc, adminInvalidations.backups),
  });
}

export function useRestoreBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "backups", "restore"],
    mutationFn: (id: string) =>
      http.post<{ applied: Record<string, number> }>(`/api/admin/backups/${id}/restore`, {}).then(unwrap),
    // A restore rewrites plans, subscriptions and every settings namespace at once,
    // so nothing in the console can be assumed current — drop the whole root rather
    // than trying to enumerate what moved.
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.all }),
  });
}
