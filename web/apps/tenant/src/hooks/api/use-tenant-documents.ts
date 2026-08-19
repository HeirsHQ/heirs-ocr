import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  http,
  unwrap,
  type DocumentReport,
  type Paginated,
  type PaginatedParams,
  type ProcessedDocument,
} from "@heirs/api-client";
import { invalidate, tenantInvalidations, tenantKeys } from "./query-keys";

/**
 * The org's processing history and its aggregate report.
 *
 * Both are scoped server-side to the caller's own tenant — the filters below are
 * narrowing only, and cannot widen the query to another org.
 */

export type DocumentFilters = PaginatedParams & {
  functionKey?: string;
  outcome?: "success" | "error";
};

export function useTenantDocuments(params?: DocumentFilters) {
  return useQuery({
    queryKey: tenantKeys.documentList(params),
    queryFn: () => http.get<Paginated<ProcessedDocument>>("/api/tenant/documents", params).then(unwrap),
    retry: false,
  });
}

/**
 * Fetches a short-lived presigned URL and hands the browser straight to it.
 *
 * A mutation rather than a query: the link expires in minutes, so it must be minted
 * at the moment of the click rather than cached alongside the row.
 */
export function useDownloadTenantDocument() {
  return useMutation({
    mutationKey: [...tenantKeys.documents, "download"],
    mutationFn: (id: string) =>
      http.get<{ url: string; fileName: string }>(`/api/tenant/documents/${id}/download`).then(unwrap),
  });
}

export function useTenantDocumentReport(days = 30) {
  return useQuery({
    queryKey: tenantKeys.documentReport(days),
    queryFn: () => http.get<DocumentReport>("/api/tenant/documents/report", { days }).then(unwrap),
    retry: false,
  });
}

/**
 * Refreshes everything a processed document makes stale.
 *
 * The `/ocr` page runs its upload with a plain `fetch` rather than a mutation (it
 * owns a multi-step flow with async job polling), so nothing invalidates on its
 * behalf. Without this, a tenant runs a document and then finds Documents, Reports
 * and Billing all still showing the state from before the run — the data is there,
 * the cache just never heard about it.
 *
 * Call it once the run has actually settled: after a synchronous result, and after a
 * queued job reaches `completed`. Not on submit — on the async path the row and the
 * metering only exist once the worker is done.
 */
export function useInvalidateAfterOcrRun() {
  const qc = useQueryClient();
  return useCallback(() => invalidate(qc, tenantInvalidations.ocrRun), [qc]);
}
