import {
  Bell,
  Box,
  Building2,
  ChartNetwork,
  DatabaseBackup,
  DollarSign,
  FileClock,
  HeartPulse,
  KeyRound,
  LucideIcon,
  ScanText,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
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
      { href: "/keys", label: "API Keys", icon: KeyRound },
      { href: "/team", label: "Team", icon: UsersRound },
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
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/security", label: "Security", icon: ShieldCheck },
      { href: "/audit-trail", label: "Audit Trail", icon: ScrollText },
      { href: "/backup-restore", label: "Backup & Restore", icon: DatabaseBackup },
      { href: "/logs", label: "Logs", icon: FileClock },
      { href: "/system-health", label: "System Health", icon: HeartPulse },
    ],
  },
];

/** The two audiences served by the app; each route group renders its own {@link AppShell}. */
export type Area = "admin" | "tenant";
