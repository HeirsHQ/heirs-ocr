"use client";

import { FileText, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useDownloadTenantDocument, useTenantDocuments } from "@/hooks/api/use-tenant-documents";
import { createDocumentColumns } from "@/config/columns/documents";
import { getErrorMessage } from "@heirs/api-client";
import { usePagination } from "@heirs/ui";
import { SelectOption } from "@heirs/ui";
import { DataTable, EmptyState, ErrorState, PageLayout, Skeleton } from "@/components/shared";

const OUTCOMES = [
  { label: "All outcomes", value: "" },
  { label: "Succeeded", value: "success" },
  { label: "Failed", value: "error" },
];

const Page = () => {
  const { params, tableProps, reset } = usePagination();
  const [outcome, setOutcome] = useState("");

  const documents = useTenantDocuments({
    ...params,
    outcome: outcome === "success" || outcome === "error" ? outcome : undefined,
  });
  const download = useDownloadTenantDocument();
  const columns = useMemo(
    () => createDocumentColumns({ onDownload: (doc) => startDownload(doc.id) }),
    // `startDownload` is stable for the life of the page; rebuilding the columns on
    // every render would reset the table's internal state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Mints a presigned link and follows it. The navigation happens in the click's
   * own turn as far as the browser is concerned — the URL points at object storage,
   * so the bytes never pass through this app.
   */
  const startDownload = (id: string) =>
    download.mutate(id, {
      onSuccess: ({ url }) => {
        window.location.href = url;
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });

  const onOutcomeChange = (next: string) => {
    setOutcome(next);
    // A narrower filter yields fewer pages; staying on page 4 would show a blank table.
    reset();
  };

  if (documents.isError)
    return (
      <PageLayout title="Documents">
        <ErrorState
          title="Couldn't load documents"
          description={getErrorMessage(documents.error)}
          onRetry={() => documents.refetch()}
          retrying={documents.isFetching}
        />
      </PageLayout>
    );

  return (
    <PageLayout
      title="Documents"
      subtitle="Every document processed through the API, with its outcome. Content is never stored."
      actions={
        <SelectOption
          options={OUTCOMES}
          value={outcome}
          onValueChange={onOutcomeChange}
          placeholder="All outcomes"
          className="w-44"
        />
      }
    >
      {/* Said plainly rather than left to be discovered: this list is deliberately
          incomplete, and a tenant counting rows against their invoice needs to know. */}
      <p className="mb-4 flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Documents processed by identity and other PII functions are never recorded here — not even their filenames.
          Usage totals on the Billing page still include them.
        </span>
      </p>

      {documents.isPending ? (
        <Skeleton skeleton="table" />
      ) : documents.data && documents.data.total === 0 ? (
        <EmptyState
          icon={FileText}
          title={outcome ? "No documents match this filter" : "No documents yet"}
          description={
            outcome ? "Try clearing the outcome filter." : "Documents processed through the OCR API will appear here."
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={documents.data?.items ?? []}
          total={documents.data?.total ?? 0}
          {...tableProps}
        />
      )}
    </PageLayout>
  );
};

export default Page;
