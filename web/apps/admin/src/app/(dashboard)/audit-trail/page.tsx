"use client";

import { ScrollText } from "lucide-react";
import { useState } from "react";

import { EmptyState, PageLayout, Skeleton } from "@/components/shared";
import { useAuditEvents } from "@/hooks/api/use-admin-console";
import { getErrorMessage } from "@heirs/api-client";
import { Input } from "@heirs/ui";
import { cn } from "@heirs/ui";

const fmt = (iso: string) => new Date(iso).toLocaleString();

/** Colour the action's namespace chip by subject, so scanning the log is faster. */
const chipTone = (action: string): string => {
  const ns = action.split(".")[0];
  switch (ns) {
    case "tenant":
      return "bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "admin":
      return "bg-violet-500/10 text-violet-700 dark:text-violet-300";
    case "subscription":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "backup":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const Page = () => {
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const events = useAuditEvents({ action: action || undefined, actor: actor || undefined });

  return (
    <PageLayout title="Audit Trail" subtitle="Administrative actions — who changed what, most recent first.">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Filter by action (e.g. tenant.)"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="max-w-xs"
          />
          <Input
            placeholder="Filter by actor"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            className="max-w-xs"
          />
        </div>

        {events.isPending && <Skeleton skeleton="table" columns={4} rows={8} />}

        {events.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {getErrorMessage(events.error)}
          </div>
        )}

        {events.data && events.data.events.length === 0 && (
          <EmptyState
            icon={ScrollText}
            title="No audit events"
            description={
              action || actor
                ? "No events match the current filters."
                : "Administrative changes to tenants, admins, subscriptions, and settings will appear here."
            }
          />
        )}

        {events.data && events.data.events.length > 0 && (
          <div className="border-hairline bg-card overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-(--surface-strong)/40 text-left text-xs text-muted-foreground">
                <tr className="border-hairline border-b">
                  <th className="px-3 py-2.5 font-medium">Time</th>
                  <th className="px-3 py-2.5 font-medium">Action</th>
                  <th className="px-3 py-2.5 font-medium">Actor</th>
                  <th className="px-3 py-2.5 font-medium">Target</th>
                </tr>
              </thead>
              <tbody>
                {events.data.events.map((e) => (
                  <tr key={e.id} className="border-hairline hover:bg-accent/40 border-b align-middle last:border-0">
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">
                      {fmt(e.createdAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn("rounded-full px-2 py-0.5 font-mono text-xs", chipTone(e.action))}>
                        {e.action}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{e.actor}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{e.target ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageLayout>
  );
};

export default Page;
