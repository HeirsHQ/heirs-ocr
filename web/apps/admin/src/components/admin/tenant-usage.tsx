"use client";

import { useState } from "react";
import { ChartColumn, Clock } from "lucide-react";

import { EmptyState, ErrorState, Shimmer, StatTile } from "@/components/shared";
import {
  ChartCard,
  LatencyErrorChart,
  RequestsOverTimeChart,
  TenantFunctionChart,
} from "@/components/admin/analytics-charts";
import { DEFAULT_RANGE_HOURS, RangeToggle } from "@/components/admin/metrics-range";
import { useMetricsTimeseries, useTenantFunctionUsage } from "@/hooks/api/use-admin-metrics";
import { getErrorMessage, MAX_PAGE_SIZE } from "@heirs/api-client";
import type { TenantUsage } from "@/types/metrics";

/**
 * One tenant's usage, for the tenant detail page.
 *
 * **The tiles and the charts do not tie out, and are not meant to.** The tiles are the
 * lifetime `tenant_usage` rollup: every call the pipeline actually ran, kept for ever.
 * The charts read the request log, which is a rolling window that ages out with
 * retention *and* records calls refused before they reached the pipeline — a tenant
 * hammering a 429 shows there and nowhere else. Either number can be the larger one
 * depending on which effect dominates, so the section captions the difference rather
 * than showing two totals that look like a bug.
 */

const num = (n: number): string => n.toLocaleString();
const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;

/**
 * The catalog is a dozen-odd functions and this is already filtered to one tenant, so
 * the whole breakdown fits in one page. Asking for the maximum makes the truncation
 * deliberate rather than a silent first page that would drop a tenant's quieter
 * functions off the chart.
 */
const FUNCTION_PAGE = { page: 1, pageSize: MAX_PAGE_SIZE };

export const TenantUsageSection = ({ tenantId, usage }: { tenantId: string; usage: TenantUsage }) => {
  const [hours, setHours] = useState<number>(DEFAULT_RANGE_HOURS);

  const byFunction = useTenantFunctionUsage({ ...FUNCTION_PAGE, tenantId });
  const series = useMetricsTimeseries(hours, tenantId);

  const functions = byFunction.data?.items ?? [];
  // A window with no traffic still returns a full-length series of zeroed buckets, so
  // "empty" is every bucket being empty rather than the array being short.
  const quiet = series.data?.points.every((p) => p.requests === 0) ?? false;
  const errorRate = usage.requests ? usage.errors / usage.requests : 0;

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold">Usage</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Requests" value={num(usage.requests)} hint="Lifetime" />
        <StatTile
          label="Error rate"
          value={pct(errorRate)}
          hint={`${num(usage.errors)} errors`}
          tone={errorRate > 0.1 ? "critical" : errorRate > 0.02 ? "warning" : "default"}
        />
        <StatTile label="Tokens used" value={num(usage.tokens)} hint="Lifetime" />
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-xs">
          The charts below read this tenant&apos;s request log — a rolling window that ages out with retention, and one
          that counts calls refused before they reached the pipeline. They will not tie out against the lifetime tiles
          above.
        </p>
        <RangeToggle hours={hours} onChange={setHours} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Requests over Time">
          {series.isPending && <Shimmer className="h-72.5 w-full rounded-md" />}
          {series.isError && (
            <ErrorState
              title="Couldn't load usage over time"
              description={getErrorMessage(series.error)}
              onRetry={() => series.refetch()}
              retrying={series.isFetching}
            />
          )}
          {series.data &&
            (quiet ? (
              <EmptyState
                icon={Clock}
                title="No requests in this window"
                description="This tenant has not called the API in the selected range. Widen the range to look further back."
              />
            ) : (
              <RequestsOverTimeChart data={series.data} />
            ))}
        </ChartCard>

        <ChartCard title="Latency & Error">
          {series.isPending && <Shimmer className="h-72.5 w-full rounded-md" />}
          {series.data &&
            (quiet ? (
              <EmptyState
                icon={Clock}
                title="No requests in this window"
                description="Latency and error rate are read from the request log. Widen the range, or wait for this tenant's next call."
              />
            ) : (
              <LatencyErrorChart data={series.data} />
            ))}
        </ChartCard>
      </div>

      {/* Full width: a tenant on ten functions needs the room, and this card carries no
          range control of its own — the by-function endpoint has no time dimension. */}
      <ChartCard title="By Function">
        {byFunction.isPending && <Shimmer className="h-72.5 w-full rounded-md" />}
        {byFunction.isError && (
          <ErrorState
            title="Couldn't load per-function usage"
            description={getErrorMessage(byFunction.error)}
            onRetry={() => byFunction.refetch()}
            retrying={byFunction.isFetching}
          />
        )}
        {byFunction.data &&
          (functions.length === 0 ? (
            <EmptyState
              icon={ChartColumn}
              title="No function calls recorded"
              description="Once this tenant runs documents through the API, its per-function volume and error counts appear here."
            />
          ) : (
            <TenantFunctionChart data={functions} />
          ))}
      </ChartCard>
    </section>
  );
};
