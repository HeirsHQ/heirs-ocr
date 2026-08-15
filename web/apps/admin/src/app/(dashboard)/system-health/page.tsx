"use client";

import { CircleCheck } from "lucide-react";

import { useHealth, useQueueStats } from "@/hooks/api/use-admin-metrics";
import { EmptyState, ErrorState, PageLayout, Skeleton, StatTile, StatusBadge } from "@/components/shared";
import { getErrorMessage } from "@heirs/api-client";

/** A dependency reads as reachable or not; the label names the dependency itself. */
const StatusPill = ({ label, ok }: { label: string; ok: boolean }) => (
  <StatusBadge tone={ok ? "healthy" : "failed"} label={`${label} · ${ok ? "up" : "down"}`} className="normal-case" />
);

const Page = () => {
  const health = useHealth();
  const queue = useQueueStats();

  const h = health.data;
  const q = queue.data;

  return (
    <PageLayout title="System Health" subtitle="Live dependency status and job-queue depth.">
      <div className=" space-y-6">
        <section className="space-y-2">
          <p className="text-sm font-medium">Dependencies</p>
          {health.isPending ? (
            <Skeleton skeleton="statistics" numberOfCards={3} />
          ) : health && health.isError ? (
            <ErrorState
              title="Couldn't load service health"
              description={getErrorMessage(health.error)}
              onRetry={() => health.refetch()}
              retrying={health.isFetching}
            />
          ) : (
            h && (
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
            )
          )}
        </section>
        <section className="space-y-2">
          <p className="text-sm font-medium">Job queue</p>
          {queue.isPending ? (
            <Skeleton skeleton="table" rows={10} />
          ) : queue && queue.isError ? (
            <ErrorState
              title="Couldn't load queue stats"
              description={getErrorMessage(queue.error)}
              onRetry={() => queue.refetch()}
              retrying={queue.isFetching}
            />
          ) : (
            q && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <StatTile label="Waiting" value={q.counts.waiting.toLocaleString()} />
                  <StatTile label="Active" value={q.counts.active.toLocaleString()} tone="notable" />
                  <StatTile label="Completed" value={q.counts.completed.toLocaleString()} />
                  <StatTile
                    label="Failed"
                    value={q.counts.failed.toLocaleString()}
                    tone={q.counts.failed > 0 ? "critical" : "default"}
                  />
                  <StatTile label="Delayed" value={q.counts.delayed.toLocaleString()} />
                </div>

                <p className="pt-2 text-sm font-medium">Recent jobs</p>
                {q.recent.length === 0 ? (
                  <EmptyState
                    icon={CircleCheck}
                    title="Queue is clear"
                    description="Nothing is waiting, running, or failed right now. Jobs appear here while they move through the worker."
                  />
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
                                <StatusBadge
                                  tone={
                                    job.status === "failed" ? "failed" : job.status === "active" ? "pending" : "healthy"
                                  }
                                  label={job.status}
                                />
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
            )
          )}
        </section>
      </div>
    </PageLayout>
  );
};

export default Page;
