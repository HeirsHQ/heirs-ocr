"use client";

import { Blocks, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";

import { ConfirmDialog, DataTable, EmptyState, PageLayout, Skeleton } from "@/components/shared";
import { useDeletePlan, usePlans } from "@/hooks/api/use-admin-plans";
import { createPlanColumns } from "@/config/columns/plans";
import { Button } from "@heirs/ui";
import { getErrorMessage } from "@heirs/api-client";
import type { Plan } from "@/types/plan";

const Page = () => {
  const plans = usePlans();
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
        editHref: (plan) => `/subscriptions/${plan.id}/edit`,
        onDelete: (plan) => setPendingDelete(plan),
      }),
    [],
  );

  return (
    <PageLayout
      title="Subscriptions"
      subtitle="The plan catalog — pricing, entitlements, and limits per tier."
      actions={[
        <Button key="new" render={<Link href="/subscriptions/new" />}>
          <Plus className="size-4" />
          New plan
        </Button>,
      ]}
    >
      <div className=" space-y-6">
        {plans.isPending && <Skeleton skeleton="table" columns={5} rows={6} />}

        {plans.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {getErrorMessage(plans.error)}
          </div>
        )}

        {plans.data && plans.data.plans.length === 0 && (
          <EmptyState
            icon={Blocks}
            title="No plans yet"
            description="The plan catalog is empty. Create one above to start assigning subscriptions."
          />
        )}

        {plans.data && plans.data.plans.length > 0 && (
          <div className="rounded-md border">
            <DataTable columns={columns} data={plans.data.plans} />
          </div>
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
