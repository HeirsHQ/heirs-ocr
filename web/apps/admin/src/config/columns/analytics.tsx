import { createColumns } from "./core";
import { TenantUsage } from "@/types/metrics";

export const usageColumns = createColumns<TenantUsage>({
  columns: [
    {
      accessorKey: "tenantId",
      header: "Tenant ID",
      cell: ({ row }) => <span className="text-xs font-mono">{row.getValue("tenantId")}</span>,
    },
    { accessorKey: "requests", header: "Requests" },
    { accessorKey: "errors", header: "Errors" },
    { accessorKey: "tokens", header: "Tokens" },
  ],
});
