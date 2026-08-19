"use client";

import { Blocks, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";

import { ConfirmDialog, DataTable, EmptyState, ErrorState, PageLayout, Skeleton } from "@/components/shared";
import { useDeletePlan, usePlans } from "@/hooks/api/use-admin-plans";
import { createPlanColumns } from "@/config/columns/plans";
import { getErrorMessage } from "@heirs/api-client";
import type { Plan } from "@/types/plan";
import { Button } from "@heirs/ui";
import { usePagination } from "@heirs/ui";

const Page = () => {
  const { params, tableProps } = usePagination();
  const plans = usePlans(params);
  const deletePlan = useDeletePlan();
  const [pendingDelete, setPendingDelete] = useState<Plan | null>(null);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const plan = pendingDelete;
    deletePlan.mutate(plan.id, {
      onSuccess: () => {
        toast.success(`Plan “${plan.name}” deleted`);
        setPendingDelete(null);
      },
      onError: (err) => toast.error(getErrorMessage(err)),
    });
  };

  const columns = useMemo(
    () =>
      createPlanColumns({
        editHref: (plan) => `/subscription-plans/${plan.id}/edit`,
        onDelete: (plan) => setPendingDelete(plan),
      }),
    [],
  );

  return (
    <PageLayout
      title="Subscription Plans"
      subtitle="The plan catalog — pricing, entitlements, and limits per tier."
      actions={[
        <Button key="new" render={<Link href="/subscription-plans/new" />}>
          <Plus className="size-4" />
          New plan
        </Button>,
      ]}
    >
      <div className=" space-y-6">
        {plans.isPending && <Skeleton skeleton="table" columns={5} rows={6} />}

        {plans.isError && (
          <ErrorState
            title="Couldn't load plans"
            description={getErrorMessage(plans.error)}
            onRetry={() => plans.refetch()}
            retrying={plans.isFetching}
          />
        )}

        {plans.data && plans.data.items.length === 0 && (
          <EmptyState
            icon={Blocks}
            title="No plans yet"
            description="The plan catalog is empty. Create one above to start assigning subscriptions."
          />
        )}

        {plans.data && plans.data.items.length > 0 && (
          <DataTable columns={columns} data={plans.data.items} total={plans.data.total} {...tableProps} />
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete plan"
        description={pendingDelete ? `“${pendingDelete.name}” will be removed from the catalog.` : undefined}
        confirmLabel="Delete"
        pending={deletePlan.isPending}
        onConfirm={confirmDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      />
    </PageLayout>
  );
};

export default Page;
