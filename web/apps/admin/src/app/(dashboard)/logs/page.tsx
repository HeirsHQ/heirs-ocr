"use client";

import { Terminal } from "lucide-react";
import { useState } from "react";

import { EmptyState, ErrorState, PageLayout, Skeleton } from "@/components/shared";
import type { LogEntry, LogLevel } from "@/types/admin-console";
import { useLogs } from "@/hooks/api/use-admin-console";
import { createLogColumns } from "@/config/columns/log";
import { ViewLog } from "@/components/admin/view-log";
import { getErrorMessage } from "@heirs/api-client";
import { cn, DataTable } from "@heirs/ui";
import { useValues } from "@/hooks";

const LEVELS: { value: LogLevel | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "info", label: "Info+" },
  { value: "warn", label: "Warn+" },
  { value: "error", label: "Errors" },
];

const Page = () => {
  const { onValueChange, values } = useValues({ level: "all" as LogLevel | "all", page: 1, size: 10 });
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const logs = useLogs(values);

  const columns = createLogColumns({
    onView: (log) => setSelected(log),
  });

  return (
    <PageLayout title="Logs" subtitle="Live tail of recent structured log entries (bounded, newest first).">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {LEVELS.map((l) => (
            <button
              key={l.value}
              onClick={() => onValueChange("level", l.value)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-sm transition-colors",
                values.level === l.value
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
        {logs.data && logs.data.entries.length === 0 ? (
          <EmptyState
            icon={Terminal}
            title="No log entries"
            description="Recent structured log lines from the running service will stream in here."
          />
        ) : (
          <DataTable columns={columns} data={logs.data?.entries || []} total={logs.data?.entries.length || 0} />
        )}
        {selected && <ViewLog log={selected} onOpenChange={() => setSelected(null)} open={selected !== null} />}
      </div>
    </PageLayout>
  );
};

export default Page;
