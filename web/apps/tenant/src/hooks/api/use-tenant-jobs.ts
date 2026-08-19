import { useQuery } from "@tanstack/react-query";

import { http, unwrap, type OcrJob, type Paginated, type PaginatedParams } from "@heirs/api-client";

import { tenantKeys } from "./query-keys";

/**
 * The org's recent async OCR jobs.
 *
 * Polled, because a queued job changes state without anything on this page acting:
 * the transition happens in the worker. `useInvalidateAfterOcrRun` also refreshes
 * this key, so a run started on `/ocr` shows up here without waiting for a tick.
 *
 * The window is bounded by the queue itself (BullMQ keeps a recent slice, not full
 * history), so this is not an audit trail — the document registry is.
 */
export function useTenantJobs(params?: PaginatedParams) {
  return useQuery({
    queryKey: [...tenantKeys.jobs, params],
    queryFn: () => http.get<Paginated<OcrJob>>("/api/tenant/jobs", params).then(unwrap),
    retry: false,
    // Matches the OCR page's own poll interval, so a job settling looks equally
    // prompt whichever screen the user happens to be on.
    refetchInterval: 5_000,
  });
}
