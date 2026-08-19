import { createColumns, DateTimeCell, StatusCell } from "./core";
import { LogEntry } from "@/types/admin-console";

interface LogEntryHandlers {
  onView: (log: LogEntry) => void;
}

export function createLogColumns({ onView }: LogEntryHandlers) {
  return createColumns<LogEntry>({
    columns: [
      { accessorKey: "time", header: "Timestamp", cell: ({ row }) => <DateTimeCell date={row.original.time} /> },
      {
        accessorKey: "level",
        header: "Level",
        cell: ({ row }) => (
          <StatusCell
            status={row.original.level}
            config={{ debug: "neutral", error: "danger", info: "info", warn: "amber" }}
          />
        ),
      },
      { accessorKey: "msg", header: "Message" },
    ],
    onRowClick: (row) => onView(row.original),
  });
}
