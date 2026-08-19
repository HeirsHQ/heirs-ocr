import type { OcrJob } from "@heirs/api-client";

import { createColumns, DateTimeCell, StatusCell, TextCell } from "./core";

/** `RECEIPT_PARSING` → `Receipt parsing`. The catalog key is an id, not a label. */
const humanize = (key: string): string => {
  const words = key.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * How long the job took, or how long it has been running.
 *
 * A queued job shows a dash rather than "0s": it has not started, and a duration of
 * zero reads as "finished instantly", which is the opposite of what is happening.
 */
const duration = (job: OcrJob): string => {
  if (!job.startedAt) return "—";
  const end = job.finishedAt ?? Date.now();
  const seconds = Math.max(0, Math.round((end - job.startedAt) / 100) / 10);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
};

export function createJobColumns() {
  return createColumns<OcrJob>({
    columns: [
      {
        accessorKey: "function",
        header: "Function",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.function ? humanize(row.original.function) : "—"}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusCell
            status={row.original.status}
            config={{ completed: "success", failed: "danger", active: "info", queued: "warning" }}
            default="neutral"
          />
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Submitted",
        cell: ({ row }) => <DateTimeCell date={row.original.createdAt ? new Date(row.original.createdAt) : null} />,
      },
      {
        id: "duration",
        header: "Duration",
        cell: ({ row }) => <TextCell value={duration(row.original)} />,
      },
      {
        accessorKey: "attempts",
        header: "Attempts",
        // Only worth showing when it is unusual — a "1" in every row is noise, but a
        // job that succeeded on its third try is exactly what someone is looking for.
        cell: ({ row }) => <TextCell value={(row.original.attempts ?? 0) > 1 ? String(row.original.attempts) : "—"} />,
      },
      {
        id: "detail",
        header: "Detail",
        cell: ({ row }) => {
          const { error, meta } = row.original;
          if (error) return <span className="text-destructive text-xs">{error.message}</span>;
          if (meta?.pageCount !== undefined)
            return <TextCell value={`${meta.pageCount} page${meta.pageCount === 1 ? "" : "s"}`} />;
          return <TextCell value="—" />;
        },
      },
    ],
  });
}
