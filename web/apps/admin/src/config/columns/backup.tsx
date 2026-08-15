import { Eye, RotateCcw } from "lucide-react";

import { BackupManifest } from "@/types/admin-console";
import { createColumns, DateTimeCell } from "./core";

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const summarize = (counts: Record<string, number>) =>
  Object.entries(counts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");

interface BackupManifestHandlers {
  onRestore: (backup: BackupManifest) => void;
  onView: (backup: BackupManifest) => void;
}

export function createBackupColumns({ onRestore, onView }: BackupManifestHandlers) {
  return createColumns<BackupManifest>({
    columns: [
      { accessorKey: "created", header: "Created", cell: ({ row }) => <DateTimeCell date={row.original.createdAt} /> },
      {
        accessorKey: "createdBy",
        header: "By",
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.createdBy}</span>,
      },
      {
        accessorKey: "contents",
        header: "Contents",
        cell: ({ row }) => <span className="font-mono text-xs">{summarize(row.original.counts)}</span>,
      },
      { accessorKey: "size", header: "Size", cell: ({ row }) => <span>{kb(row.original.sizeBytes)}</span> },
      { accessorKey: "note", header: "Note", cell: ({ row }) => <span>{row.original.note || "--"}</span> },
    ],
    actions: (backup) => [
      { label: "View", icon: Eye, onClick: () => onView(backup) },
      { label: "Restore", icon: RotateCcw, onClick: () => onRestore(backup) },
    ],
  });
}
