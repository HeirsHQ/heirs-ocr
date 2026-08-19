import { useQuery } from "@tanstack/react-query";

import { http, unwrap, type Paginated, type PaginatedParams, type TenantRequestLog } from "@heirs/api-client";

import { tenantKeys } from "./query-keys";

/**
 * The org's API request history.
 *
 * Polls, because entries arrive from traffic this page has no part in — someone
 * watching while their integration runs should see calls appear.
 */
export type RequestLogFilters = PaginatedParams & {
  functionKey?: string;
  outcome?: "success" | "error";
};

export function useTenantLogs(params?: RequestLogFilters) {
  return useQuery({
    queryKey: [...tenantKeys.logs, params],
    queryFn: () => http.get<Paginated<TenantRequestLog>>("/api/tenant/logs", params).then(unwrap),
    retry: false,
    refetchInterval: 15_000,
  });
}
