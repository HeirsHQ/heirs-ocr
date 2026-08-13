import { Trash2 } from "lucide-react";

import type { TenantApiKey } from "@/types/user";
import { createColumns, DateCell, StatusCell } from "./core";

interface KeyColumnHandlers {
  onRevoke: (key: TenantApiKey) => void;
}

export function createKeyColumns({ onRevoke }: KeyColumnHandlers) {
  return createColumns<TenantApiKey>({
    columns: [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => <span className="font-medium">{row.original.name || "Unnamed key"}</span>,
      },
      {
        accessorKey: "prefix",
        header: "Key",
        cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.prefix}…</span>,
      },
      {
        accessorKey: "disabled",
        header: "Status",
        cell: ({ row }) => <StatusCell status={row.original.disabled ? "revoked" : "active"} default="neutral" />,
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        cell: ({ row }) => <DateCell date={row.original.createdAt ?? null} />,
      },
    ],
    actions: (key) => [
      { label: "Revoke", icon: Trash2, variant: "destructive", hidden: key.disabled, onClick: () => onRevoke(key) },
    ],
  });
}
