import { useQuery } from "@tanstack/react-query";

import { http, unwrap, type OcrJob, type Paginated, type PaginatedParams } from "@heirs/api-client";

import { tenantKeys } from "./query-keys";

/**
 * The org's recent async OCR jobs.
 *
 * Refreshed by the job event stream (`useJobEvents`), which pushes each transition as
 * the worker makes it. Polling stays as the fallback for a dropped stream: `streaming`
 * stretches it from 5s to 30s rather than switching it off, so the page still
 * converges if events stop arriving and nobody notices. `useInvalidateAfterOcrRun`
 * also refreshes this key, so a run started on `/ocr` shows up here immediately.
 *
 * The window is bounded by the queue itself (BullMQ keeps a recent slice, not full
 * history), so this is not an audit trail — the document registry is.
 */
export function useTenantJobs(params?: PaginatedParams, options?: { streaming?: boolean }) {
  return useQuery({
    queryKey: [...tenantKeys.jobs, params],
    queryFn: () => http.get<Paginated<OcrJob>>("/api/tenant/jobs", params).then(unwrap),
    retry: false,
    refetchInterval: options?.streaming ? 30_000 : 5_000,
  });
}
