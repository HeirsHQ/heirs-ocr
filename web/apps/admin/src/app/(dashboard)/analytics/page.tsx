"use client";

import { useState } from "react";
import { Building2, ChartColumn, Clock } from "lucide-react";

import { EmptyState, ErrorState, PageLayout, Shimmer, Skeleton, StatTile, cn } from "@/components/shared";
import {
  FunctionVolumeChart,
  LatencyErrorChart,
  RequestsOverTimeChart,
  TenantVolumeChart,
} from "@/components/admin/analytics-charts";
import { useMetricsSummary, useMetricsTimeseries, useTenantUsage } from "@/hooks/api/use-admin-metrics";
import { getErrorMessage } from "@heirs/api-client";

const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;
const num = (n: number): string => n.toLocaleString();

/**
 * Presets rather than a free date picker: the buckets the endpoint returns are chosen
 * from the window (hourly up to 48h, daily beyond), so an arbitrary range would let a
 * reader pick one that renders as a thousand unreadable hour ticks.
 */
const RANGES = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
] as const;

/** The top tenants by request volume — the usage list is already sorted busiest-first. */
const TENANT_LIMIT = 10;

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-4 rounded-lg border p-4">
    <p className="text-sm font-medium">{title}</p>
    {children}
  </div>
);

const Page = () => {
  const [hours, setHours] = useState<number>(RANGES[0].hours);

  const metrics = useMetricsSummary();
  const usage = useTenantUsage({ page: 1, pageSize: TENANT_LIMIT });
  const series = useMetricsTimeseries(hours);

  const m = metrics.data;
  const byFunction = m?.byFunction ?? [];
  const tenants = usage.data?.items ?? [];
  // Requests that ran before the per-function rollup existed. They are counted in the
  // headline totals (which come from tenant_usage) but cannot be attributed to a
  // function, so the breakdown is captioned instead of quietly disagreeing with the
  // tile above it.
  const unattributed = m ? m.totalRequests - m.functionRequests : 0;

  return (
    <PageLayout title="Analytics" subtitle="Request volume, errors, and token usage across the service.">
      <div className="space-y-6">
        {metrics.isPending && <Skeleton skeleton="statistics" numberOfCards={4} />}
        {metrics.isError && (
          <ErrorState
            title="Couldn't load metrics"
            description={getErrorMessage(metrics.error)}
            onRetry={() => metrics.refetch()}
            retrying={metrics.isFetching}
          />
        )}
        {m && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Total requests" value={num(m.totalRequests)} />
            <StatTile label="Error rate" value={pct(m.errorRate)} hint={`${num(m.errorRequests)} errors`} />
            <StatTile label="Tokens used" value={num(m.totalTokens)} />
            <StatTile
              label="Provider fallbacks"
              value={num(m.providerFallbacks)}
              hint={unattributed > 0 ? `of ${num(m.functionRequests)} attributed requests` : undefined}
            />
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-2">
          <Card title="By Function">
            {metrics.isPending && <Shimmer className="h-72.5 w-full rounded-md" />}
            {m &&
              (byFunction.length === 0 ? (
                <EmptyState
                  icon={ChartColumn}
                  title="No requests recorded yet"
                  description="Once tenants start running documents through the API, per-function volume and error rates appear here."
                />
              ) : (
                <FunctionVolumeChart data={byFunction} />
              ))}
          </Card>

          <Card title="By Tenant">
            {usage.isPending && <Shimmer className="h-72.5 w-full rounded-md" />}
            {usage.isError && (
              <ErrorState
                title="Couldn't load tenant usage"
                description={getErrorMessage(usage.error)}
                onRetry={() => usage.refetch()}
                retrying={usage.isFetching}
              />
            )}
            {usage.data &&
              (tenants.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title="No tenant usage yet"
                  description="Usage is attributed per tenant as they call the API. Provision a tenant and run a document to see it here."
                />
              ) : (
                <TenantVolumeChart data={tenants} />
              ))}
          </Card>
        </section>

        <div className="flex items-center justify-between gap-4">
          <p className="text-muted-foreground text-xs">
            Over time, from the request log — a rolling window that ages out with retention, and one that counts calls
            refused before they reached the pipeline. It will not tie out against the lifetime totals above.
          </p>
          <div className="bg-muted flex w-fit shrink-0 items-center rounded-md p-1">
            {RANGES.map((range) => (
              <button
                key={range.hours}
                onClick={() => setHours(range.hours)}
                aria-pressed={hours === range.hours}
                className={cn(
                  "rounded-md px-3 py-1 text-sm",
                  hours === range.hours ? "bg-primary text-white" : "text-muted-foreground",
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
        <section className="grid gap-6 lg:grid-cols-2">
          <Card title="Function Latency & Error">
            {series.isPending && <Shimmer className="h-72.5 w-full rounded-md" />}
            {series.isError && (
              <ErrorState
                title="Couldn't load latency"
                description={getErrorMessage(series.error)}
                onRetry={() => series.refetch()}
                retrying={series.isFetching}
              />
            )}
            {series.data &&
              (series.data.points.every((p) => p.requests === 0) ? (
                <EmptyState
                  icon={Clock}
                  title="No requests in this window"
                  description="Latency and error rate are read from the request log. Widen the range, or send a request to see the series fill in."
                />
              ) : (
                <LatencyErrorChart data={series.data} />
              ))}
          </Card>

          <Card title="Requests over Time">
            {series.isPending && <Shimmer className="h-72.5 w-full rounded-md" />}
            {series.data &&
              (series.data.points.every((p) => p.requests === 0) ? (
                <EmptyState
                  icon={Clock}
                  title="No requests in this window"
                  description="Nothing has been called in the selected range. Widen the range to look further back."
                />
              ) : (
                <RequestsOverTimeChart data={series.data} />
              ))}
          </Card>
        </section>
      </div>
    </PageLayout>
  );
};

export default Page;
