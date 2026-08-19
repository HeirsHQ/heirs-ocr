import { useMutation, useQuery } from "@tanstack/react-query";

import { http, unwrap, type TenantExport, type TenantExportSummary } from "@heirs/api-client";

import { tenantKeys } from "./query-keys";

/** What an export would contain — shown before anything is downloaded. */
export function useTenantExportSummary() {
  return useQuery({
    queryKey: tenantKeys.backup,
    queryFn: () => http.get<TenantExportSummary>("/api/tenant/backup").then(unwrap),
    retry: false,
  });
}

/**
 * Builds the export and hands it to the browser as a file.
 *
 * Saved client-side from a Blob rather than relying on a `Content-Disposition`
 * header: the request passes through the Next BFF proxy, which forwards only the
 * content type, so a download header set upstream would be dropped on the way back.
 */
export function useDownloadTenantExport() {
  return useMutation({
    mutationKey: ["tenant", "backup", "download"],
    mutationFn: async () => {
      const payload = await http.get<TenantExport>("/api/tenant/backup/export").then(unwrap);

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `heirs-ocr-export-${payload.tenantId}-${payload.generatedAt.slice(0, 10)}.json`;
      link.click();
      // Revoke once the click has been handled, or the object leaks for the session.
      URL.revokeObjectURL(url);

      return payload;
    },
  });
}
