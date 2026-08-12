"use client";

import { useState } from "react";

import { PageLayout } from "@/components/shared";
import { Input } from "@/components/ui/input";
import { useAuditEvents } from "@/hooks/api/use-admin-console";
import { getErrorMessage } from "@/lib/client";

const fmt = (iso: string) => new Date(iso).toLocaleString();

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

        {events.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {events.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {getErrorMessage(events.error)}
          </div>
        )}

        {events.data && events.data.events.length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">
            No audit events recorded yet.
          </p>
        )}

        {events.data && events.data.events.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                </tr>
              </thead>
              <tbody>
                {events.data.events.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmt(e.createdAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.actor}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{e.target ?? "—"}</td>
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
