"use client";

import { Building2, ChartColumn } from "lucide-react";

import { DataTable, EmptyState, ErrorState, PageLayout, Skeleton, StatTile } from "@/components/shared";
import { useMetricsSummary, useTenantUsage } from "@/hooks/api/use-admin-metrics";
import { functionColumns, usageColumns } from "@/config/columns/analytics";
import { getErrorMessage } from "@heirs/api-client";
import { usePagination } from "@heirs/ui";

const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;
const num = (n: number): string => n.toLocaleString();

const Page = () => {
  const metrics = useMetricsSummary();
  const { params, tableProps } = usePagination();
  const usage = useTenantUsage(params);
  // The per-function rollup arrives whole (one row per catalog function), so it pages
  // in the browser. It still needs *some* page state: DataTable renders a pagination
  // bar whenever `total` exceeds the page size, and without handlers that bar was
  // inert — it claimed "1–10 of 12" while all 12 rows were on screen.
  const fn = usePagination();

  const m = metrics.data;
  const allRows = m?.byFunction ?? [];
  const rows = allRows.slice((fn.params.page - 1) * fn.params.pageSize, fn.params.page * fn.params.pageSize);
  const tenants = usage.data?.items ?? [];

  return (
    <PageLayout title="Analytics" subtitle="Request volume, errors, and token usage across the service.">
      <div className=" space-y-6">
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
            <StatTile label="Provider fallbacks" value={num(m.providerFallbacks)} />
          </div>
        )}
        {m && (
          <section className="space-y-2">
            <p className="text-sm font-medium">By Function</p>
            {allRows.length === 0 ? (
              <EmptyState
                icon={ChartColumn}
                title="No requests recorded yet"
                description="Once tenants start running documents through the API, per-function volume and error rates appear here."
              />
            ) : (
              <DataTable columns={functionColumns} data={rows} total={allRows.length} {...fn.tableProps} />
            )}
          </section>
        )}
        <section className="space-y-2">
          <p className="text-sm font-medium">By Tenant</p>
          {usage.isPending && <Skeleton skeleton="table" columns={4} rows={5} />}
          {usage.isError && (
            <ErrorState
              title="Couldn't load tenant usage"
              description={getErrorMessage(usage.error)}
              onRetry={() => usage.refetch()}
              retrying={usage.isFetching}
            />
          )}
          {usage.data && tenants.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No tenant usage yet"
              description="Usage is attributed per tenant as they call the API. Provision a tenant and run a document to see it here."
            />
          ) : (
            <DataTable
              columns={usageColumns}
              data={usage.data?.items ?? []}
              total={usage.data?.total ?? 0}
              {...tableProps}
            />
          )}
        </section>
      </div>
    </PageLayout>
  );
};

export default Page;
