"use client";

import { Loader, MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "../ui/button";

/** One live sign-in. Mirrors `ActiveSession` in @heirs/api-client. */
export type ActiveSessionView = {
  id: string;
  createdAt: number;
  ip?: string;
  userAgent?: string;
  current: boolean;
};

/**
 * A user-agent string is unreadable; this pulls out the browser and platform, which
 * is the only part someone uses to recognise their own device.
 */
const describeAgent = (ua?: string): string => {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : "Browser";
  const platform = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return platform ? `${browser} on ${platform}` : browser;
};

const when = (ms: number): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));

/**
 * Active sessions plus a "sign out everywhere else" control, shared by the console
 * and the portal.
 *
 * Revocation is deliberately all-or-nothing rather than per-row: someone reaching
 * for this has lost a device or suspects a compromise, and picking the right row off
 * a list of IP addresses is exactly the judgement they cannot reliably make. The
 * current session is marked and never revoked, so the action can't sign you out.
 */
export const SessionList = ({
  sessions,
  loading,
  onRevokeOthers,
  formatError = (err) => (err instanceof Error && err.message ? err.message : "Couldn't revoke sessions."),
}: {
  sessions?: ActiveSessionView[];
  loading?: boolean;
  onRevokeOthers: () => Promise<{ revoked: number }>;
  formatError?: (err: unknown) => string;
}) => {
  const [busy, setBusy] = useState(false);
  const others = (sessions ?? []).filter((s) => !s.current).length;

  const revoke = async () => {
    setBusy(true);
    try {
      const { revoked } = await onRevokeOthers();
      toast.success(
        revoked === 0
          ? "No other sessions to sign out"
          : `Signed out ${revoked} other session${revoked === 1 ? "" : "s"}`,
      );
    } catch (err) {
      toast.error(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Active sessions</p>
          <p className="text-xs text-muted-foreground">
            Sign out all other devices. Your current session stays active.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={revoke} disabled={busy || loading || others === 0}>
          {busy ? <Loader className="size-3.5 animate-spin" /> : "Revoke all other sessions"}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
          <Loader className="size-3.5 animate-spin" />
          Loading sessions…
        </div>
      ) : (sessions ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          No active sessions found.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {sessions!.map((session) => (
            <li key={session.id} className="flex items-center gap-3 px-3 py-2.5">
              <MonitorSmartphone className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {describeAgent(session.userAgent)}
                  {session.current && (
                    <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                      This device
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {session.ip ?? "unknown IP"} · signed in {when(session.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
