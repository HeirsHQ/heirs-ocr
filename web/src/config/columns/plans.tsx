import { Pencil, Trash2 } from "lucide-react";

import type { BillingModel, Money, Plan } from "@/types/plan";
import { createColumns, StatusCell } from "./core";

const money = (m: Money): string => `${m.currency} ${(m.amountMinor / 100).toLocaleString()}`;

/** One-line pricing summary for a plan's billing model. */
export const billingSummary = (b: BillingModel): string => {
  if (b.kind === "trial") return "Free trial";
  if (b.kind === "per_document")
    return `${money(b.unitPrice)}/doc${b.perPageSurcharge ? ` + ${money(b.perPageSurcharge)}/pg` : ""}`;
  const incl = b.includedDocuments === null ? "unlimited" : b.includedDocuments.toLocaleString();
  return `${money(b.basePrice)}/mo · ${incl} incl`;
};

interface PlanColumnHandlers {
  /** Builds the edit-page href for a plan (e.g. `/subscriptions/:id/edit`). */
  editHref: (plan: Plan) => string;
  onDelete: (plan: Plan) => void;
}

export function createPlanColumns({ editHref, onDelete }: PlanColumnHandlers) {
  return createColumns<Plan>({
    columns: [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.name}</span>
            {row.original.hidden && <span className="text-xs text-muted-foreground">· hidden</span>}
          </div>
        ),
      },
      {
        accessorKey: "tier",
        header: "Tier",
        cell: ({ row }) => <StatusCell status={row.original.tier} default="info" />,
      },
      {
        id: "billing",
        header: "Billing",
        cell: ({ row }) => <span className="text-sm">{billingSummary(row.original.billing)}</span>,
      },
      {
        id: "sensitivity",
        header: "Sensitivity",
        cell: ({ row }) => <span className="text-sm capitalize">{row.original.entitlements.maxSensitivity}</span>,
      },
      {
        id: "functions",
        header: "Functions",
        cell: ({ row }) => {
          const count = row.original.entitlements.allowedFunctions.length;
          return <span className="text-sm">{count === 0 ? "All" : `${count}`}</span>;
        },
      },
    ],
    actions: (plan) => [
      { label: "Edit", icon: Pencil, variant: "info", href: editHref(plan) },
      { label: "Delete", icon: Trash2, variant: "destructive", onClick: () => onDelete(plan) },
    ],
  });
}
