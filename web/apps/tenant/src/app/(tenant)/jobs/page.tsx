"use client";

import { ListTodo } from "lucide-react";
import { useMemo, useState } from "react";

import { useTenantJobs } from "@/hooks/api/use-tenant-jobs";
import { createJobColumns } from "@/config/columns/jobs";
import { getErrorMessage } from "@heirs/api-client";
import { usePagination } from "@heirs/ui";
import { SelectOption } from "@heirs/ui";
import { DataTable, EmptyState, ErrorState, PageLayout, Skeleton } from "@/components/shared";

const STATUSES = [
  { label: "All statuses", value: "" },
  { label: "Queued", value: "queued" },
  { label: "Active", value: "active" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
];

const Page = () => {
  const { params, tableProps, reset } = usePagination();
  const [status, setStatus] = useState("");

  const jobs = useTenantJobs(params);
  const columns = useMemo(() => createJobColumns(), []);

  // Filtered client-side: the endpoint returns the queue's bounded recent window
  // rather than a queryable history, so there is nothing to narrow server-side.
  const items = useMemo(
    () => (status ? (jobs.data?.items ?? []).filter((j) => j.status === status) : (jobs.data?.items ?? [])),
    [jobs.data, status],
  );

  const onStatusChange = (next: string) => {
    setStatus(next);
    reset();
  };

  if (jobs.isError)
    return (
      <PageLayout title="Job Queues">
        <ErrorState
          title="Couldn't load jobs"
          description={getErrorMessage(jobs.error)}
          onRetry={() => jobs.refetch()}
          retrying={jobs.isFetching}
        />
      </PageLayout>
    );

  return (
    <PageLayout
      title="Job Queues"
      subtitle="Async OCR jobs for your organisation. Large documents are processed in the background."
      actions={
        <SelectOption
          options={STATUSES}
          value={status}
          onValueChange={onStatusChange}
          placeholder="All statuses"
          className="w-44"
        />
      }
    >
      {jobs.isPending ? (
        <Skeleton skeleton="table" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title={status ? "No jobs with this status" : "No jobs queued"}
          description={
            status
              ? "Try clearing the status filter."
              : "Documents over the size or page threshold are processed in the background and appear here."
          }
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={items}
            total={status ? items.length : (jobs.data?.total ?? 0)}
            {...tableProps}
          />
          {/* The queue keeps a recent slice, not full history — say so, rather than
              letting an incomplete list read as missing data. */}
          <p className="mt-3 text-xs text-muted-foreground">
            Shows recent jobs only. For a complete processing history, see Documents.
          </p>
        </>
      )}
    </PageLayout>
  );
};

export default Page;
