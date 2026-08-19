import {
  BarChart2,
  Bell,
  Box,
  Building2,
  ChartNetwork,
  DatabaseBackup,
  DollarSign,
  FileStack,
  HeartPulse,
  KeyRound,
  ListChecks,
  Logs,
  LucideIcon,
  Plug,
  ScanText,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Webhook,
} from "lucide-react";

export interface Route {
  href: string;
  label: string;
  children?: Route[];
  disabled?: boolean;
  icon?: LucideIcon;
}

export interface RouteGroup {
  name: string;
  routes: Route[];
  disabled?: boolean;
}

export const TENANT_ROUTES: RouteGroup[] = [
  {
    name: "main",
    routes: [
      { href: "/ocr", label: "OCR", icon: ScanText },
      { href: "/billing", label: "Billing & Usage", icon: DollarSign },
      { href: "/team", label: "Team", icon: Users },
      { href: "/documents", label: "Documents", icon: FileStack },
      { href: "/reports", label: "Reports", icon: BarChart2 },
      { href: "/keys", label: "API Keys", icon: KeyRound },
    ],
  },
  {
    name: "system",
    routes: [
      { href: "/webhooks", label: "Webhooks", icon: Webhook },
      { href: "/jobs", label: "Job Queues", icon: ListChecks },
      // "Request Logs", not "Audit Logs": this is the org's own API call history, not
      // a record of administrative changes.
      { href: "/logs", label: "Request Logs", icon: Logs },
      { href: "/backup", label: "Backup", icon: DatabaseBackup },
      { href: "/security", label: "Security", icon: ShieldCheck },
    ],
  },
];

export const ADMIN_ROUTES: RouteGroup[] = [
  {
    name: "main",
    routes: [
      { href: "/analytics", label: "Analytics", icon: ChartNetwork },
      { href: "/tenants", label: "Tenants", icon: Building2 },
      { href: "/subscriptions", label: "Subscriptions", icon: Box },
      { href: "/users", label: "Users", icon: Users },
    ],
  },
  {
    name: "system",
    routes: [
      { href: "/platform-configurations", label: "Platform Configurations", icon: Settings },
      { href: "/subscription-plans", label: "Subscription Plans", icon: DollarSign },
      { href: "/api-integrations", label: "API Integrations", icon: Plug },
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/security", label: "Security", icon: ShieldCheck },
      { href: "/audit-trail", label: "Audit Trail", icon: ScrollText },
      { href: "/backup-restore", label: "Backup & Restore", icon: DatabaseBackup },
      { href: "/logs", label: "Logs", icon: Logs },
      { href: "/system-health", label: "System Health", icon: HeartPulse },
    ],
  },
];

/** The two audiences served by the app; each route group renders its own {@link AppShell}. */
export type Area = "admin" | "tenant";
