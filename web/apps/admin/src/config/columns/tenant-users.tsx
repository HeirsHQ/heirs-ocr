import type { TenantUserView } from "@/types/tenant";
import { createColumns, DateCell, TextCell } from "./core";

export function createTenantUserColumns() {
  return createColumns<TenantUserView>({
    columns: [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.name}</span>
            {row.original.disabled && <span className="text-xs text-muted-foreground">· disabled</span>}
          </div>
        ),
      },
      { accessorKey: "email", header: "Email", cell: ({ row }) => <TextCell value={row.original.email} /> },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground capitalize">
            {row.original.role}
          </span>
        ),
      },
      { accessorKey: "createdAt", header: "Joined", cell: ({ row }) => <DateCell date={row.original.createdAt} /> },
    ],
  });
}
