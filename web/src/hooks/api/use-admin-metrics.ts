import { useQuery } from "@tanstack/react-query";

import { http, unwrap } from "@/lib/client";
import type { HealthStatus, MetricsSummary, QueueStats, TenantUsage } from "@/types/metrics";

/** Admin observability reads (viewer+ on the backend), via the admin BFF proxy. */

/** Service health; polled so the console reflects live dependency state. */
export function useHealth() {
  return useQuery({
    queryKey: ["admin", "health"],
    queryFn: () => http.get<HealthStatus>("/api/admin/health").then(unwrap),
    retry: false,
    refetchInterval: 15_000,
  });
}

/** Job-queue depth and recent jobs; polled for a near-live view. */
export function useQueueStats() {
  return useQuery({
    queryKey: ["admin", "queue"],
    queryFn: () => http.get<QueueStats>("/api/admin/queue").then(unwrap),
    retry: false,
    refetchInterval: 10_000,
  });
}

export function useMetricsSummary() {
  return useQuery({
    queryKey: ["admin", "metrics", "summary"],
    queryFn: () => http.get<MetricsSummary>("/api/admin/metrics/summary").then(unwrap),
    retry: false,
    refetchInterval: 30_000,
  });
}

export function useTenantUsage() {
  return useQuery({
    queryKey: ["admin", "usage"],
    queryFn: () => http.get<{ usage: TenantUsage[] }>("/api/admin/usage").then(unwrap),
    retry: false,
    refetchInterval: 30_000,
  });
}
