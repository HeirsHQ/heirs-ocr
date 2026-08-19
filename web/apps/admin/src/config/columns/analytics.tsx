import { FunctionMetric, TenantUsage } from "@/types/metrics";
import { createColumns, PercentageCell } from "./core";

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

export const functionColumns = createColumns<FunctionMetric>({
  columns: [
    {
      accessorKey: "function",
      header: "Function",
    },
    { accessorKey: "requests", header: "Requests" },
    { accessorKey: "errors", header: "Errors" },
    { accessorKey: "tokens", header: "Tokens" },
    {
      accessorKey: "lowConfidenceRatio",
      header: "Low-confidence",
      cell: ({ row }) => <PercentageCell value={row.getValue("lowConfidenceRatio")} />,
    },
  ],
});
