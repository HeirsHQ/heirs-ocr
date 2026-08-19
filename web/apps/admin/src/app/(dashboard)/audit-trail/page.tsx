"use client";

import { ScrollText } from "lucide-react";
import { useState } from "react";

import { DataTable, EmptyState, ErrorState, PageLayout, Skeleton } from "@/components/shared";
import { ViewAuditEvent } from "@/components/admin/view-audit-event";
import { createAuditColumns } from "@/config/columns/audit-log";
import { useAuditEvents } from "@/hooks/api/use-admin-console";
import { Pagination, usePagination } from "@heirs/ui";
import { getErrorMessage } from "@heirs/api-client";
import { AuditEvent } from "@/types/admin-console";
import { useValues } from "@/hooks";
import { Input } from "@heirs/ui";

const Page = () => {
  const { onValueChange, values } = useValues({ action: "", actor: "" });
  const [event, setEvent] = useState<AuditEvent | null>(null);
  const { params, reset, tableProps } = usePagination();

  const { action, actor } = values;
  const events = useAuditEvents({ action: action || undefined, actor: actor || undefined, ...params });

  // Narrowing the filter shortens the list, so a viewer sitting on page 6 would
  // otherwise land past its end and see nothing.
  const onFilter = (field: "action" | "actor", value: string) => {
    onValueChange(field, value);
    reset();
  };

  const columns = createAuditColumns((event) => setEvent(event));

  return (
    <PageLayout title="Audit Trail" subtitle="Administrative actions — who changed what, most recent first.">
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Input
            placeholder="Filter by action (e.g. tenant.)"
            value={action}
            onChange={(e) => onFilter("action", e.target.value)}
            wrapperClassName="max-w-xs"
          />
          <Input
            placeholder="Filter by actor"
            value={actor}
            onChange={(e) => onFilter("actor", e.target.value)}
            wrapperClassName="max-w-xs"
          />
        </div>
        {events.isPending && <Skeleton skeleton="table" columns={4} rows={8} />}
        {events.isError && (
          <ErrorState
            title="Couldn't load audit events"
            description={getErrorMessage(events.error)}
            onRetry={() => events.refetch()}
            retrying={events.isFetching}
          />
        )}
        {events.data && events.data.items.length === 0 && (
          <EmptyState
            icon={ScrollText}
            title="No audit events"
            description={
              action || actor
                ? "No events match the current filters."
                : "Administrative changes to tenants, admins, subscriptions, and settings will appear here."
            }
          />
        )}
        {events.data && events.data.items.length > 0 && (
          <DataTable columns={columns} data={events.data.items} total={events.data.total} {...tableProps} />
        )}
        {events.data && events.data.total > 0 && (
          <Pagination
            total={events.data.total}
            page={tableProps.page}
            pageSize={tableProps.pageSize}
            onPageChange={tableProps.onPageChange}
            onPageSizeChange={tableProps.onPageSizeChange}
          />
        )}
      </div>
      {event && <ViewAuditEvent event={event} open onOpenChange={(open) => !open && setEvent(null)} />}
    </PageLayout>
  );
};

export default Page;
