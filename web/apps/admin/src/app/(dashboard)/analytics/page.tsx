"use client";

import { Building2, ChartColumn } from "lucide-react";

import { DataTable, EmptyState, ErrorState, PageLayout, Skeleton, StatTile } from "@/components/shared";
import { useMetricsSummary, useTenantFunctionUsage, useTenantUsage } from "@/hooks/api/use-admin-metrics";
import { functionColumns, tenantFunctionColumns, usageColumns } from "@/config/columns/analytics";
import { getErrorMessage } from "@heirs/api-client";
import { usePagination } from "@heirs/ui";

const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;
const num = (n: number): string => n.toLocaleString();

const Page = () => {
  const metrics = useMetricsSummary();
  const { params, tableProps } = usePagination();
  const usage = useTenantUsage(params);
  const byTenantFn = usePagination();
  const tenantFn = useTenantFunctionUsage(byTenantFn.params);
  // The per-function rollup arrives whole (one row per catalog function), so it pages
  // in the browser. It still needs *some* page state: DataTable renders a pagination
  // bar whenever `total` exceeds the page size, and without handlers that bar was
  // inert — it claimed "1–10 of 12" while all 12 rows were on screen.
  const fn = usePagination();

  const m = metrics.data;
  const allRows = m?.byFunction ?? [];
  const rows = allRows.slice((fn.params.page - 1) * fn.params.pageSize, fn.params.page * fn.params.pageSize);
  const tenants = usage.data?.items ?? [];
  // Requests that ran before the per-function rollup existed. They are counted in the
  // headline totals (which come from tenant_usage) but cannot be attributed to a
  // function, so the breakdown is captioned instead of quietly disagreeing with the
  // tile above it.
  const unattributed = m ? m.totalRequests - m.functionRequests : 0;

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
            <StatTile
              label="Provider fallbacks"
              value={num(m.providerFallbacks)}
              hint={unattributed > 0 ? `of ${num(m.functionRequests)} attributed requests` : undefined}
            />
          </div>
        )}
        {m && (
          <section className="space-y-2">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">By Function</p>
              {unattributed > 0 && (
                <p className="text-xs text-muted-foreground text-pretty">
                  Covers {num(m.functionRequests)} of {num(m.totalRequests)} requests. The other {num(unattributed)} ran
                  before per-function counters existed and are included in the totals above, but cannot be attributed to
                  a function.
                </p>
              )}
            </div>
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

        <section className="space-y-2">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">By Tenant &amp; Function</p>
            <p className="text-xs text-muted-foreground text-pretty">
              From the request log, so this is a rolling window rather than a lifetime total, and it counts calls that
              were refused before reaching the pipeline — over quota, rate limited, unsupported file type. Expect it to
              disagree with the totals above in both directions.
            </p>
          </div>
          {tenantFn.isPending && <Skeleton skeleton="table" columns={4} rows={5} />}
          {tenantFn.isError && (
            <ErrorState
              title="Couldn't load per-function usage"
              description={getErrorMessage(tenantFn.error)}
              onRetry={() => tenantFn.refetch()}
              retrying={tenantFn.isFetching}
            />
          )}
          {tenantFn.data &&
            (tenantFn.data.items.length === 0 ? (
              <EmptyState
                icon={ChartColumn}
                title="No per-function activity yet"
                description="Each API call is logged with the function it targeted. Once tenants start calling the API, the split appears here."
              />
            ) : (
              <DataTable
                columns={tenantFunctionColumns}
                data={tenantFn.data.items}
                total={tenantFn.data.total}
                {...byTenantFn.tableProps}
              />
            ))}
        </section>
      </div>
    </PageLayout>
  );
};

export default Page;
