import type { TenantRequestLog } from "@heirs/api-client";

import { createColumns, DateTimeCell, TextCell } from "./core";

/** `RECEIPT_PARSING` → `Receipt parsing`. The catalog key is an id, not a label. */
const humanize = (key: string): string => {
  const words = key.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Status colouring by class rather than by exact code.
 *
 * 4xx is amber, not red: those are the caller's own mistakes — over quota, wrong file
 * type — which are actionable by the tenant. 5xx is red because it is ours.
 */
const statusTone = (status: number): string => {
  if (status >= 500) return "text-destructive";
  if (status >= 400) return "text-warning";
  return "text-success";
};

export function createLogColumns() {
  return createColumns<TenantRequestLog>({
    columns: [
      {
        accessorKey: "createdAt",
        header: "When",
        cell: ({ row }) => <DateTimeCell date={row.original.createdAt ?? null} />,
      },
      {
        accessorKey: "method",
        header: "Request",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.method} {row.original.path}
          </span>
        ),
      },
      {
        accessorKey: "functionKey",
        header: "Function",
        cell: ({ row }) => <TextCell value={row.original.functionKey ? humanize(row.original.functionKey) : "—"} />,
      },
      {
        accessorKey: "statusCode",
        header: "Status",
        cell: ({ row }) => (
          <span className={`font-mono text-xs font-medium ${statusTone(row.original.statusCode)}`}>
            {row.original.statusCode}
            {row.original.errorCode && (
              <span className="ml-2 font-normal text-muted-foreground">{row.original.errorCode}</span>
            )}
          </span>
        ),
      },
      {
        accessorKey: "durationMs",
        header: "Duration",
        cell: ({ row }) => (
          <TextCell value={row.original.durationMs === null ? "—" : `${row.original.durationMs} ms`} />
        ),
      },
      {
        accessorKey: "requestId",
        header: "Request ID",
        // Quote this back to support and they can find the exact call.
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-muted-foreground">{row.original.requestId ?? "—"}</span>
        ),
      },
    ],
  });
}
