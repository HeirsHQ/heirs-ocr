import { createColumns, DateTimeCell } from "./core";
import { AuditEvent } from "@/types/admin-console";
import { cn } from "@heirs/ui";

/**
 * Namespace → chip colour, so the action reads the same in the table and in the
 * detail dialog. Exported to keep those two from drifting apart.
 */
export const chipTone = (action: string): string => {
  const ns = action.split(".")[0];
  switch (ns) {
    case "tenant":
      return "bg-(--chart-1)/12 text-(--chart-1)";
    case "admin":
      return "bg-(--chart-2)/12 text-(--chart-2)";
    case "subscription":
      return "bg-(--chart-3)/12 text-(--chart-3)";
    case "backup":
      return "bg-(--chart-4)/12 text-(--chart-4)";
    default:
      return "bg-muted text-muted-foreground";
  }
};

export function createAuditColumns(onRowClick: (event: AuditEvent) => void) {
  return createColumns<AuditEvent>({
    columns: [
      {
        accessorKey: "createdAt",
        header: "Timestamp",
        cell: ({ row }) => <DateTimeCell date={row.original.createdAt} />,
      },
      { accessorKey: "actionLabel", header: "Action Label" },
      {
        accessorKey: "action",
        header: "Action",
        cell: ({ row }) => (
          <div
            className={cn(
              "mt-0.5 inline-block rounded-full px-2 py-0.5 font-mono text-[11px]",
              chipTone(row.original.action),
            )}
          >
            {row.original.action}
          </div>
        ),
      },
      {
        accessorKey: "actorLabel",
        header: "Actor",
        cell: ({ row }) => <span className="text-sm">{row.original.actorLabel || "--"}</span>,
      },
      {
        accessorKey: "targetLabel",
        header: "Target",
        cell: ({ row }) => <span className="text-sm">{row.original.targetLabel || "--"}</span>,
      },
    ],
    onRowClick: (row) => onRowClick(row.original),
  });
}
