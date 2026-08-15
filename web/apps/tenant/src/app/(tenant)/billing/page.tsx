"use client";

import { CreditCard, DollarSign } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { getErrorMessage } from "@heirs/api-client";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  EmptyState,
  ErrorState,
  PageLayout,
  Skeleton,
  StatTile,
} from "@heirs/ui";
import { useTenantBilling } from "@/hooks/api/use-tenant-billing";
import type { Subscription } from "@/types/subscription";

const date = (value: string): string =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));

const currencyOf = (sub: Subscription): string => {
  const billing = sub.plan.billing;
  if (billing.kind === "per_document") return billing.unitPrice.currency;
  if (billing.kind === "monthly") return billing.basePrice.currency;
  return "NGN";
};

const money = (sub: Subscription): string =>
  `${currencyOf(sub)} ${(sub.usage.amountAccruedMinor / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;

const allowance = (sub: Subscription): string => {
  const cap = sub.plan.entitlements.limits.documentsPerPeriod;
  if (cap === null) return "Unlimited";
  return `${Math.max(0, cap - sub.usage.documentsProcessed).toLocaleString()} left`;
};

const usagePercent = (sub: Subscription): number => {
  const cap = sub.plan.entitlements.limits.documentsPerPeriod;
  if (!cap) return 0;
  return Math.min(100, Math.round((sub.usage.documentsProcessed / cap) * 100));
};

const Page = () => {
  const billing = useTenantBilling();
  const sub = billing.data?.subscription ?? null;
  const usage = billing.data?.usage;
  const chartData = sub
    ? [
        { name: "Documents", value: sub.usage.documentsProcessed },
        { name: "Pages", value: sub.usage.pagesProcessed },
        { name: "Tokens", value: sub.usage.tokensUsed },
      ]
    : [
        { name: "Requests", value: usage?.requests ?? 0 },
        { name: "Errors", value: usage?.errors ?? 0 },
        { name: "Tokens", value: usage?.tokens ?? 0 },
      ];

  return (
    <PageLayout title="Billing & Usage" subtitle="View your current subscription and usage statistics.">
      <div className="space-y-6">
        {billing.isError && (
          <ErrorState
            title="Couldn't load billing"
            description={getErrorMessage(billing.error)}
            onRetry={() => billing.refetch()}
            retrying={billing.isFetching}
          />
        )}
        {billing.isPending ? (
          <Skeleton skeleton="table" columns={5} rows={6} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
              <StatTile label="Plan" value={sub?.plan.name ?? "—"} hint={sub ? sub.status : "not enrolled"} />
              <StatTile
                label="Documents"
                value={sub ? sub.usage.documentsProcessed.toLocaleString() : (usage?.requests ?? 0).toLocaleString()}
                hint={sub ? allowance(sub) : "lifetime requests"}
                tone={sub && usagePercent(sub) >= 90 ? "warning" : "default"}
              />
              <StatTile
                label="Pages"
                value={sub ? sub.usage.pagesProcessed.toLocaleString() : "—"}
                hint={sub ? `${usagePercent(sub)}% of allowance` : "needs a plan"}
              />
              <StatTile
                label="Accrued"
                value={sub ? money(sub) : "—"}
                hint={sub ? "this period" : "no subscription"}
                tone="notable"
              />
            </div>

            {!sub ? (
              <EmptyState
                icon={DollarSign}
                title="No subscription assigned"
                description="Ask an admin to assign a plan before billing and period usage can be tracked here."
              />
            ) : (
              <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
                <section className="border-hairline bg-card rounded-lg border p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <CreditCard className="size-4 text-muted-foreground" />
                    <div>
                      <h2 className="text-sm font-semibold">Current period</h2>
                      <p className="text-xs text-muted-foreground">
                        {date(sub.currentPeriodStart)} — {date(sub.currentPeriodEnd)}
                      </p>
                    </div>
                  </div>
                  <ChartContainer
                    config={{ value: { label: "Usage", color: "var(--chart-1)" } }}
                    className="max-h-72 min-h-64"
                  >
                    <BarChart data={chartData}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} />
                      <YAxis tickLine={false} axisLine={false} width={52} />
                      <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                      <Bar dataKey="value" fill="var(--color-value)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </section>

                <section className="border-hairline bg-card space-y-3 rounded-lg border p-4 text-sm">
                  <h2 className="font-semibold">Plan limits</h2>
                  <dl className="grid gap-2">
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Retention</dt>
                      <dd>{sub.plan.entitlements.limits.dataRetentionDays} days</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Max pages</dt>
                      <dd>{sub.plan.entitlements.limits.maxPagesPerDocument ?? "Function default"}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Rate limit</dt>
                      <dd>{sub.plan.entitlements.limits.rateLimitPerMinute ?? "Default"} / min</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Payment</dt>
                      <dd className="capitalize">{sub.payment.provider}</dd>
                    </div>
                  </dl>
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </PageLayout>
  );
};

export default Page;
