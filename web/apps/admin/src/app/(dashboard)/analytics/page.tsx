"use client";

import { useMetricsSummary, useTenantUsage } from "@/hooks/api/use-admin-metrics";
import { PageLayout, Skeleton, StatTile } from "@/components/shared";
import { getErrorMessage } from "@heirs/api-client";

const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;
const num = (n: number): string => n.toLocaleString();

const Page = () => {
  const metrics = useMetricsSummary();
  const usage = useTenantUsage();

  const m = metrics.data;
  const rows = m?.byFunction ?? [];
  const tenants = usage.data?.usage ?? [];

  return (
    <PageLayout title="Analytics" subtitle="Request volume, errors, and token usage across the service.">
      <div className=" space-y-6">
        {/* Summary tiles */}
        {metrics.isPending && <Skeleton skeleton="statistics" numberOfCards={4} />}
        {metrics.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {getErrorMessage(metrics.error)}
          </div>
        )}
        {m && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Total requests" value={num(m.totalRequests)} />
            <StatTile label="Error rate" value={pct(m.errorRate)} hint={`${num(m.errorRequests)} errors`} />
            <StatTile label="Tokens used" value={num(m.totalTokens)} />
            <StatTile label="Provider fallbacks" value={num(m.providerFallbacks)} />
          </div>
        )}

        {/* Per-function */}
        {m && (
          <section className="space-y-2">
            <p className="text-sm font-medium">By function</p>
            {rows.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                No requests recorded yet.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-3 py-2 font-medium">Function</th>
                      <th className="px-3 py-2 text-right font-medium">Requests</th>
                      <th className="px-3 py-2 text-right font-medium">Errors</th>
                      <th className="px-3 py-2 text-right font-medium">Tokens</th>
                      <th className="px-3 py-2 text-right font-medium">Low-confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.function} className="border-b last:border-0">
                        <td className="px-3 py-2">{r.function}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(r.requests)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(r.errors)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(r.tokens)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(r.lowConfidenceRatio)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Per-tenant usage */}
        <section className="space-y-2">
          <p className="text-sm font-medium">By tenant</p>
          {usage.isPending && <Skeleton skeleton="table" columns={4} rows={5} />}
          {usage.isError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {getErrorMessage(usage.error)}
            </div>
          )}
          {usage.data && tenants.length === 0 && (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              No tenant usage recorded yet.
            </p>
          )}
          {tenants.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-3 py-2 font-medium">Tenant</th>
                    <th className="px-3 py-2 text-right font-medium">Requests</th>
                    <th className="px-3 py-2 text-right font-medium">Errors</th>
                    <th className="px-3 py-2 text-right font-medium">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.tenantId} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{t.tenantId}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(t.requests)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(t.errors)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(t.tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </PageLayout>
  );
};

export default Page;
