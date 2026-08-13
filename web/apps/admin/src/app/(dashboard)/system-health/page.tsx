"use client";

import { useHealth, useQueueStats } from "@/hooks/api/use-admin-metrics";
import { PageLayout, Skeleton, StatTile } from "@/components/shared";
import { getErrorMessage } from "@heirs/api-client";
import { cn } from "@heirs/ui";

const Dot = ({ ok }: { ok: boolean }) => (
  <span className={cn("inline-block size-2 rounded-full", ok ? "bg-emerald-500" : "bg-destructive")} />
);

const StatusPill = ({ label, ok }: { label: string; ok: boolean }) => (
  <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
    <Dot ok={ok} />
    {label}
    <span className="text-xs text-muted-foreground">{ok ? "up" : "down"}</span>
  </span>
);

const Page = () => {
  const health = useHealth();
  const queue = useQueueStats();

  const h = health.data;
  const q = queue.data;

  return (
    <PageLayout title="System Health" subtitle="Live dependency status and job-queue depth.">
      <div className=" space-y-6">
        {/* Dependencies */}
        <section className="space-y-2">
          <p className="text-sm font-medium">Dependencies</p>
          {health.isPending && <p className="text-sm text-muted-foreground">Checking…</p>}
          {health.isError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {getErrorMessage(health.error)}
            </div>
          )}
          {h && (
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill label="Redis" ok={h.redis} />
              <StatusPill label="Postgres" ok={h.postgres} />
              <StatusPill label="Tesseract" ok={h.providers.tesseract} />
              <StatusPill label="Azure OpenAI" ok={h.providers.azureOpenAI} />
              <StatusPill label="GLM" ok={h.providers.glm} />
              <span className="ml-auto text-xs text-muted-foreground">
                status: {h.status} · v{h.version}
              </span>
            </div>
          )}
        </section>

        {/* Queue */}
        <section className="space-y-2">
          <p className="text-sm font-medium">Job queue</p>
          {queue.isPending && <Skeleton skeleton="statistics" numberOfCards={5} />}
          {queue.isError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {getErrorMessage(queue.error)}
            </div>
          )}
          {q && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <StatTile label="Waiting" value={q.counts.waiting.toLocaleString()} />
                <StatTile label="Active" value={q.counts.active.toLocaleString()} />
                <StatTile label="Completed" value={q.counts.completed.toLocaleString()} />
                <StatTile label="Failed" value={q.counts.failed.toLocaleString()} />
                <StatTile label="Delayed" value={q.counts.delayed.toLocaleString()} />
              </div>

              <p className="pt-2 text-sm font-medium">Recent jobs</p>
              {q.recent.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                  No active or failed jobs.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="px-3 py-2 font-medium">Job</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Function</th>
                        <th className="px-3 py-2 font-medium">Tenant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.recent.map((job) => (
                        <tr key={job.jobId} className="border-b last:border-0">
                          <td className="px-3 py-2 font-mono text-xs">{job.jobId}</td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1.5">
                              <Dot ok={job.status !== "failed"} />
                              {job.status}
                            </span>
                          </td>
                          <td className="px-3 py-2">{job.function}</td>
                          <td className="px-3 py-2 font-mono text-xs">{job.tenantId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </PageLayout>
  );
};

export default Page;
