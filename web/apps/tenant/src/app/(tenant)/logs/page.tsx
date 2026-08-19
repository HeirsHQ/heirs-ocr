"use client";

import { ScrollText } from "lucide-react";
import { useMemo, useState } from "react";

import { useTenantLogs } from "@/hooks/api/use-tenant-logs";
import { createLogColumns } from "@/config/columns/logs";
import { getErrorMessage } from "@heirs/api-client";
import { SelectOption, usePagination } from "@heirs/ui";
import { DataTable, EmptyState, ErrorState, PageLayout, Skeleton } from "@/components/shared";

const OUTCOMES = [
  { label: "All requests", value: "" },
  { label: "Succeeded", value: "success" },
  { label: "Failed", value: "error" },
];

const Page = () => {
  const { params, tableProps, reset } = usePagination();
  const [outcome, setOutcome] = useState("");

  const logs = useTenantLogs({
    ...params,
    outcome: outcome === "success" || outcome === "error" ? outcome : undefined,
  });
  const columns = useMemo(() => createLogColumns(), []);

  const onOutcomeChange = (next: string) => {
    setOutcome(next);
    // A narrower filter yields fewer pages; staying on page 4 would show a blank table.
    reset();
  };

  if (logs.isError)
    return (
      <PageLayout title="Logs">
        <ErrorState
          title="Couldn't load logs"
          description={getErrorMessage(logs.error)}
          onRetry={() => logs.refetch()}
          retrying={logs.isFetching}
        />
      </PageLayout>
    );

  return (
    <PageLayout
      title="Logs"
      subtitle="Every API call your organisation made, including the ones that were refused."
      actions={
        <SelectOption
          options={OUTCOMES}
          value={outcome}
          onValueChange={onOutcomeChange}
          placeholder="All requests"
          className="w-44"
        />
      }
    >
      {/* Worth saying: this is the one place a rejected call is visible. Documents
          only lists what actually processed. */}
      <p className="mb-4 text-xs text-muted-foreground">
        Requests refused before processing — over quota, rate limited, unsupported file — appear here but not under
        Documents. Quote a request ID to support to have a specific call looked up.
      </p>

      {logs.isPending ? (
        <Skeleton skeleton="table" />
      ) : (logs.data?.total ?? 0) === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={outcome ? "No requests match this filter" : "No API requests yet"}
          description={
            outcome ? "Try clearing the filter." : "Calls to the OCR API appear here as your integration runs."
          }
        />
      ) : (
        <DataTable columns={columns} data={logs.data?.items ?? []} total={logs.data?.total ?? 0} {...tableProps} />
      )}
    </PageLayout>
  );
};

export default Page;
