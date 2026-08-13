/** Admin-console feature shapes, mirroring the backend `/admin/api` endpoints. */

/** `GET /api/admin/audit`. */
export interface AuditEvent {
  id: string;
  action: string;
  actor: string;
  target: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

/** `GET /api/admin/logs`. */
export interface LogEntry {
  level: LogLevel;
  msg: string;
  time: string;
  fields: Record<string, unknown>;
}

// ── Settings namespaces ───────────────────────────────────────────────────────

export interface NotificationChannel {
  id: string;
  type: "email" | "webhook";
  target: string;
  enabled: boolean;
}

export interface NotificationSettings {
  channels: NotificationChannel[];
  events: {
    jobFailed: boolean;
    quotaExceeded: boolean;
    tenantCreated: boolean;
    subscriptionChanged: boolean;
  };
}

export interface Integration {
  id: string;
  name: string;
  kind: string;
  url: string;
  enabled: boolean;
  createdAt: string;
}

export interface ApiIntegrationSettings {
  integrations: Integration[];
}

export interface PlatformSettings {
  maintenanceMode: boolean;
  defaultTenantRateLimit: number;
  supportEmail: string;
  featureFlags: Record<string, boolean>;
}

export interface SecuritySettings {
  enforceHttps: boolean;
  sessionIdleTimeoutMinutes: number;
  passwordMinLength: number;
  ipAllowlist: string[];
}

export interface SecurityPosture {
  authEnabled: boolean;
  rateLimitEnabled: boolean;
  rateLimitMax: number;
  rateLimitWindowSeconds: number;
  adminSessionTtlSeconds: number;
  tenantSessionTtlSeconds: number;
  corsClosed: boolean;
}

// ── Backups ───────────────────────────────────────────────────────────────────

export interface BackupManifest {
  id: string;
  createdAt: string;
  createdBy: string;
  note: string | null;
  counts: Record<string, number>;
  sizeBytes: number;
}
