import type { Subscription, SubscriptionStatus } from "@/types/subscription";
import { StatusBadge, type StatusTone } from "@heirs/ui";
import { billingSummary } from "./plans";
import { createColumns } from "./core";

/**
 * Billing status → operational meaning. `past_due` is amber rather than red: the
 * tenant is still being served while dunning retries, so it needs a look, not an
 * alarm. `suspended` is the red one — access is actually cut.
 */
const STATUS_TONE: Record<SubscriptionStatus, StatusTone> = {
  active: "healthy",
  trialing: "pending",
  past_due: "attention",
  suspended: "failed",
  canceled: "inactive",
  expired: "inactive",
};

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** Period usage against the plan's allowance; `null` allowance = unlimited. */
const usageLabel = (sub: Subscription): string => {
  const used = sub.usage.documentsProcessed.toLocaleString();
  const cap = sub.plan.entitlements.limits.documentsPerPeriod;
  return cap === null ? `${used} / ∞` : `${used} / ${cap.toLocaleString()}`;
};

export function createSubscriptionColumns() {
  return createColumns<Subscription>({
    columns: [
      {
        accessorKey: "tenantId",
        header: "Tenant",
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.tenantId}</span>,
      },
      {
        id: "plan",
        header: "Plan",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.plan.name}</span>
            <span className="text-xs text-muted-foreground">{billingSummary(row.original.plan.billing)}</span>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          // The derived status, not the stored one: a lapsed trial is still recorded
          // as `trialing` but is already being refused by the API.
          <StatusBadge
            tone={STATUS_TONE[row.original.effectiveStatus ?? row.original.status]}
            label={(row.original.effectiveStatus ?? row.original.status).replace("_", " ")}
          />
        ),
      },
      {
        id: "usage",
        header: "Documents this period",
        cell: ({ row }) => <span className="text-sm tabular-nums">{usageLabel(row.original)}</span>,
      },
      {
        id: "period",
        header: "Renews",
        cell: ({ row }) => (
          <span className="text-sm">
            {formatDate(row.original.currentPeriodEnd)}
            {row.original.cancelAtPeriodEnd && <span className="text-muted-foreground"> · cancelling</span>}
          </span>
        ),
      },
    ],
  });
}
