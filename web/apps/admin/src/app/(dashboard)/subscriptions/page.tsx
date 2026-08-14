"use client";

import { Box } from "lucide-react";
import { useMemo } from "react";

import { DataTable, EmptyState, ErrorState, PageLayout, Skeleton } from "@/components/shared";
import { createSubscriptionColumns } from "@/config/columns/subscriptions";
import { useSubscriptions } from "@/hooks/api/use-admin-subscriptions";
import type { Subscription } from "@/types/subscription";
import { getErrorMessage } from "@heirs/api-client";
import { StatTile } from "@heirs/ui";

/**
 * Live tenant enrolments. The plan *catalog* is managed separately under
 * `/subscription-plans`; this page shows who is on what, and what they've used.
 */

/**
 * Accrued revenue this period. Subscriptions snapshot their own plan, so tenants can
 * legitimately be on different currencies — summing across them would be nonsense.
 * Totalled per currency and rendered as the dominant one, with the rest as a hint.
 */
const accruedByCurrency = (subs: Subscription[]): Array<[string, number]> => {
  const totals = new Map<string, number>();
  for (const sub of subs) {
    const currency = currencyOf(sub);
    totals.set(currency, (totals.get(currency) ?? 0) + sub.usage.amountAccruedMinor);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
};

/** A plan's currency, whichever billing arm it uses. */
const currencyOf = (sub: Subscription): string => {
  const billing = sub.plan.billing;
  if (billing.kind === "per_document") return billing.unitPrice.currency;
  if (billing.kind === "monthly") return billing.basePrice.currency;
  return "NGN"; // a free trial accrues nothing; the code is only a grouping key
};

const money = (currency: string, minor: number): string => `${currency} ${(minor / 100).toLocaleString()}`;

const Page = () => {
  const subscriptions = useSubscriptions();
  const columns = useMemo(() => createSubscriptionColumns(), []);

  const subs = subscriptions.data?.subscriptions ?? [];
  const accrued = accruedByCurrency(subs);
  const serving = subs.filter((s) => s.status === "active" || s.status === "trialing").length;
  const attention = subs.filter((s) => s.status === "past_due" || s.status === "suspended").length;

  return (
    <PageLayout
      title="Subscriptions"
      subtitle="Every tenant's live plan enrolment, status, and usage this billing period."
    >
      <div className="space-y-6">
        {subscriptions.isError && (
          <ErrorState
            title="Couldn't load subscriptions"
            description={getErrorMessage(subscriptions.error)}
            onRetry={() => subscriptions.refetch()}
            retrying={subscriptions.isFetching}
          />
        )}

        {subscriptions.isPending ? (
          <Skeleton skeleton="table" columns={5} rows={6} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
              <StatTile label="Subscriptions" value={subs.length} />
              <StatTile label="Serving" value={serving} hint="active or trialing" tone="success" />
              <StatTile
                label="Needs attention"
                value={attention}
                hint={attention > 0 ? "past due or suspended" : "none past due"}
                tone={attention > 0 ? "warning" : "default"}
              />
              <StatTile
                tone="notable"
                label="Accrued this period"
                value={accrued.length ? money(accrued[0][0], accrued[0][1]) : "—"}
                hint={
                  accrued.length > 1
                    ? accrued
                        .slice(1)
                        .map(([c, v]) => money(c, v))
                        .join(" · ")
                    : undefined
                }
              />
            </div>

            {subs.length === 0 && !subscriptions.isError ? (
              <EmptyState
                icon={Box}
                title="No subscriptions yet"
                description="Assign a plan to a tenant from the Tenants page to enrol them."
              />
            ) : (
              <DataTable columns={columns} data={subs} total={subs.length} />
            )}
          </>
        )}
      </div>
    </PageLayout>
  );
};

export default Page;
