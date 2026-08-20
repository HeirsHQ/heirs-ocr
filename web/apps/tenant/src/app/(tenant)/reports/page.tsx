"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { BarChart2, Clock } from "lucide-react";
import { useState } from "react";

import { useTenantDocumentReport } from "@/hooks/api/use-tenant-documents";
import { getErrorMessage } from "@heirs/api-client";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  EmptyState,
  ErrorState,
  PageLayout,
  SelectOption,
  Skeleton,
  StatTile,
  formatSize,
} from "@heirs/ui";

const WINDOWS = [
  { label: "Last 7 days", value: "7" },
  { label: "Last 30 days", value: "30" },
  { label: "Last 90 days", value: "90" },
];

/** `RECEIPT_PARSING` → `Receipt parsing`. The catalog key is an id, not a label. */
const humanize = (key: string): string => {
  const words = key.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Short axis label — the API returns ISO dates. */
const day = (iso: string): string =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${iso}T00:00:00Z`));

const Page = () => {
  const [windowDays, setWindowDays] = useState("30");
  const report = useTenantDocumentReport(Number(windowDays));

  const data = report.data;
  const totals = data?.totals;
  const errorRate = totals && totals.documents > 0 ? Math.round((totals.errors / totals.documents) * 100) : 0;

  const daily = (data?.daily ?? []).map((d) => ({ ...d, label: day(d.date) }));
  const byFunction = (data?.byFunction ?? []).map((f) => ({ ...f, label: humanize(f.functionKey) }));

  if (report.isError)
    return (
      <PageLayout title="Reports">
        <ErrorState
          title="Couldn't load reports"
          description={getErrorMessage(report.error)}
          onRetry={() => report.refetch()}
          retrying={report.isFetching}
        />
      </PageLayout>
    );

  return (
    <PageLayout
      title="Reports"
      subtitle="OCR processing activity over time. Excludes PII functions, which are never recorded."
      actions={<SelectOption options={WINDOWS} value={windowDays} onValueChange={setWindowDays} className="w-40" />}
    >
      {report.isPending ? (
        <Skeleton skeleton="table" columns={4} rows={6} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            <StatTile
              label="Documents"
              value={(totals?.documents ?? 0).toLocaleString()}
              hint={`last ${data?.windowDays ?? 30} days`}
            />
            <StatTile label="Pages" value={(totals?.pages ?? 0).toLocaleString()} hint="extracted" />
            <StatTile
              label="Failures"
              value={(totals?.errors ?? 0).toLocaleString()}
              hint={`${errorRate}% of documents`}
              tone={errorRate >= 10 ? "warning" : "default"}
            />
            <StatTile label="Volume" value={formatSize(totals?.bytes ?? 0)} hint="uploaded" />
          </div>
          {/* Retention stated on the page: a history that stops at 90 days looks like
              data loss unless the reason is visible next to the chart. */}
          {data?.retention && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="size-3.5 shrink-0" />
              {data.retention.enabled
                ? `Records are kept for ${data.retention.documentRetentionDays} days, then deleted automatically.`
                : "Automatic deletion is currently paused, so older records are retained."}
            </p>
          )}

          {!totals || totals.documents === 0 ? (
            <EmptyState
              icon={BarChart2}
              title="Nothing processed in this window"
              description="Try a longer window, or run a document through the OCR page."
            />
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
              <section className="border-hairline bg-card rounded-lg border p-4">
                <h2 className="mb-4 text-sm font-semibold">Documents per day</h2>
                <ChartContainer
                  config={{
                    documents: { label: "Documents", color: "var(--chart-1)" },
                    errors: { label: "Failures", color: "var(--chart-3)" },
                  }}
                  className="max-h-72 min-h-64"
                >
                  <AreaChart data={daily}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      dataKey="documents"
                      stroke="var(--color-documents)"
                      fill="var(--color-documents)"
                      fillOpacity={0.15}
                    />
                    <Area dataKey="errors" stroke="var(--color-errors)" fill="var(--color-errors)" fillOpacity={0.15} />
                  </AreaChart>
                </ChartContainer>
              </section>
              <section className="border-hairline bg-card rounded-lg border p-4">
                <h2 className="mb-4 text-sm font-semibold">By function</h2>
                <ChartContainer
                  config={{ documents: { label: "Documents", color: "var(--chart-2)" } }}
                  className="max-h-72 min-h-64"
                >
                  <BarChart data={byFunction} layout="vertical">
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={120} />
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Bar dataKey="documents" fill="var(--color-documents)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ChartContainer>
              </section>
            </div>
          )}
        </div>
      )}
    </PageLayout>
  );
};

export default Page;
