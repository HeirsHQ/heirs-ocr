import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { http, unwrap } from "@/lib/client";
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

/**
 * Admin-console feature reads/writes (audit trail, logs, platform settings,
 * configuration backups), via the admin BFF proxy (`/api/admin/*` → backend
 * `/admin/api/*`). Reads are viewer+, writes manager+ server-side.
 */

// ── Audit trail ───────────────────────────────────────────────────────────────

export function useAuditEvents(filter: { action?: string; actor?: string } = {}) {
  return useQuery({
    queryKey: ["admin", "audit", filter],
    queryFn: () => http.get<{ events: AuditEvent[] }>("/api/admin/audit", filter).then(unwrap),
    retry: false,
    refetchInterval: 30_000,
  });
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export function useLogs(level?: LogLevel) {
  return useQuery({
    queryKey: ["admin", "logs", level ?? "all"],
    queryFn: () => http.get<{ entries: LogEntry[] }>("/api/admin/logs", level ? { level } : undefined).then(unwrap),
    retry: false,
    refetchInterval: 10_000,
  });
}

// ── Settings (generic read + write per namespace) ─────────────────────────────

function useSettings<T>(path: string, key: string) {
  return useQuery({
    queryKey: ["admin", "settings", key],
    queryFn: () => http.get<{ settings: T }>(`/api/admin/settings/${path}`).then(unwrap),
    retry: false,
  });
}

function useSaveSettings<T>(path: string, key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "settings", key, "save"],
    mutationFn: (settings: T) => http.put<{ settings: T }>(`/api/admin/settings/${path}`, settings).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "settings", key] }),
  });
}

export const useNotifications = () => useSettings<NotificationSettings>("notifications", "notifications");
export const useSaveNotifications = () => useSaveSettings<NotificationSettings>("notifications", "notifications");

export const useApiIntegrations = () => useSettings<ApiIntegrationSettings>("api-integrations", "api_integrations");
export const useSaveApiIntegrations = () =>
  useSaveSettings<ApiIntegrationSettings>("api-integrations", "api_integrations");

export const usePlatformSettings = () => useSettings<PlatformSettings>("platform", "platform");
export const useSavePlatformSettings = () => useSaveSettings<PlatformSettings>("platform", "platform");

// ── Security (dedicated endpoint: settings + live posture) ────────────────────

export function useSecurity() {
  return useQuery({
    queryKey: ["admin", "security"],
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "security"] }),
  });
}

// ── Backups ───────────────────────────────────────────────────────────────────

const BACKUPS = ["admin", "backups"];

export function useBackups() {
  return useQuery({
    queryKey: BACKUPS,
    queryFn: () => http.get<{ backups: BackupManifest[] }>("/api/admin/backups").then(unwrap),
    retry: false,
  });
}

export function useCreateBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "backups", "create"],
    mutationFn: (note?: string) => http.post<{ backup: BackupManifest }>("/api/admin/backups", { note }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: BACKUPS }),
  });
}

export function useRestoreBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "backups", "restore"],
    mutationFn: (id: string) =>
      http.post<{ applied: Record<string, number> }>(`/api/admin/backups/${id}/restore`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });
}
