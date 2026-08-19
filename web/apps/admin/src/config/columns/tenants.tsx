import { Eye, KeyRound, Trash2, Users } from "lucide-react";

import type { AdminTenant } from "@/types/tenant";
import { createColumns, DateCell, TextCell } from "./core";

interface TenantColumnHandlers {
  onOwners: (row: AdminTenant) => void;
  onPlan: (row: AdminTenant) => void;
  onDelete: (row: AdminTenant) => void;
  /** Opens the tenant — the same destination as the row menu's "View". */
  onOpen: (row: AdminTenant) => void;
}

export function createTenantColumns({ onOwners, onPlan, onDelete, onOpen }: TenantColumnHandlers) {
  return createColumns<AdminTenant>({
    onRowClick: (row) => onOpen(row.original),
    columns: [
      {
        id: "name",
        header: "Name",
        cell: ({ row }) => {
          const { tenant } = row.original;
          return (
            <div className="flex items-center gap-2">
              <span className="font-medium">{tenant.name || tenant.tenantId}</span>
              {tenant.disabled && <span className="text-xs text-muted-foreground">· disabled</span>}
            </div>
          );
        },
      },
      {
        id: "tenantId",
        header: "Tenant ID",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.tenant.tenantId}</span>
        ),
      },
      {
        id: "rateLimit",
        header: "Rate limit",
        cell: ({ row }) => (
          <TextCell value={row.original.tenant.rateLimit ? `${row.original.tenant.rateLimit}/min` : null} />
        ),
      },
      {
        id: "functions",
        header: "Functions",
        cell: ({ row }) => {
          const count = row.original.tenant.allowedFunctions?.length ?? 0;
          return <span className="text-sm">{count === 0 ? "All" : `${count}`}</span>;
        },
      },
      {
        id: "createdAt",
        header: "Created",
        cell: ({ row }) => <DateCell date={row.original.tenant.createdAt ?? null} />,
      },
    ],
    actions: (row) => [
      { label: "View", icon: Eye, href: `/tenants/${row.tenant.tenantId}` },
      { label: "Owners", icon: Users, onClick: () => onOwners(row) },
      { label: "Plan", icon: KeyRound, onClick: () => onPlan(row) },
      { label: "Revoke", icon: Trash2, variant: "destructive", onClick: () => onDelete(row) },
    ],
  });
}
