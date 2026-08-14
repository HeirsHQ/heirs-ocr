"use client";

import { Terminal } from "lucide-react";
import { useState } from "react";

import { EmptyState, ErrorState, PageLayout, Skeleton } from "@/components/shared";
import { useLogs } from "@/hooks/api/use-admin-console";
import type { LogLevel } from "@/types/admin-console";
import { getErrorMessage } from "@heirs/api-client";
import { cn } from "@heirs/ui";

const LEVELS: { value: LogLevel | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "info", label: "Info+" },
  { value: "warn", label: "Warn+" },
  { value: "error", label: "Errors" },
];

const levelClass: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-primary",
  warn: "text-warning",
  error: "text-destructive",
};

const fmt = (iso: string) => new Date(iso).toLocaleTimeString();

const Page = () => {
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const logs = useLogs(level === "all" ? undefined : level);

  return (
    <PageLayout title="Logs" subtitle="Live tail of recent structured log entries (bounded, newest first).">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {LEVELS.map((l) => (
            <button
              key={l.value}
              onClick={() => setLevel(l.value)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-sm transition-colors",
                level === l.value
                  ? "border-ring bg-accent font-medium"
                  : "border-hairline text-muted-foreground hover:bg-accent/50",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>

        {logs.isPending && <Skeleton skeleton="table" columns={3} rows={10} />}

        {logs.isError && (
          <ErrorState
            title="Couldn't load logs"
            description={getErrorMessage(logs.error)}
            onRetry={() => logs.refetch()}
            retrying={logs.isFetching}
          />
        )}

        {logs.data && logs.data.entries.length === 0 && (
          <EmptyState
            icon={Terminal}
            title="No log entries"
            description="Recent structured log lines from the running service will stream in here."
          />
        )}

        {logs.data && logs.data.entries.length > 0 && (
          <div className="border-hairline bg-(--canvas-soft) overflow-x-auto rounded-md border font-mono text-xs">
            <ul className="divide-y divide-(--hairline)">
              {logs.data.entries.map((e, i) => (
                <li key={i} className="hover:bg-accent/40 flex gap-3 px-3 py-1.5 transition-colors">
                  <span className="whitespace-nowrap tabular-nums text-muted-foreground">{fmt(e.time)}</span>
                  <span className={cn("w-12 shrink-0 font-semibold uppercase", levelClass[e.level])}>{e.level}</span>
                  <span className="flex-1 break-all">
                    {e.msg}
                    {Object.keys(e.fields).length > 0 && (
                      <span className="ml-2 text-muted-foreground">{JSON.stringify(e.fields)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </PageLayout>
  );
};

export default Page;
