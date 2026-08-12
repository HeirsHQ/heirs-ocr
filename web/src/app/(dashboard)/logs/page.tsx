"use client";

import { useState } from "react";

import { PageLayout } from "@/components/shared";
import { useLogs } from "@/hooks/api/use-admin-console";
import { getErrorMessage } from "@/lib/client";
import { cn } from "@/lib/utils";
import type { LogLevel } from "@/types/admin-console";

const LEVELS: { value: LogLevel | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "info", label: "Info+" },
  { value: "warn", label: "Warn+" },
  { value: "error", label: "Errors" },
];

const levelClass: Record<LogLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-sky-600 dark:text-sky-400",
  warn: "text-amber-600 dark:text-amber-400",
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
                "rounded-md border px-2.5 py-1 text-sm",
                level === l.value ? "border-ring bg-accent" : "text-muted-foreground",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>

        {logs.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {logs.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {getErrorMessage(logs.error)}
          </div>
        )}

        {logs.data && logs.data.entries.length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">
            No log entries buffered yet.
          </p>
        )}

        {logs.data && logs.data.entries.length > 0 && (
          <div className="overflow-x-auto rounded-md border bg-muted/30 font-mono text-xs">
            <ul className="divide-y">
              {logs.data.entries.map((e, i) => (
                <li key={i} className="flex gap-3 px-3 py-1.5">
                  <span className="whitespace-nowrap text-muted-foreground">{fmt(e.time)}</span>
                  <span className={cn("w-12 shrink-0 font-semibold uppercase", levelClass[e.level])}>{e.level}</span>
                  <span className="flex-1">
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
