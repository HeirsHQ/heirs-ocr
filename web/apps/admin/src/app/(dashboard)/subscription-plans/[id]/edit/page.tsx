"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, SearchX } from "lucide-react";

import { EmptyState, ErrorState, PageLayout, Skeleton } from "@/components/shared";
import { Button } from "@heirs/ui";
import { PlanForm } from "@/components/admin/plan-form";
import { usePlans } from "@/hooks/api/use-admin-plans";
import { getErrorMessage, MAX_PAGE_SIZE } from "@heirs/api-client";

const Page = ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = use(params);
  const router = useRouter();
  // Looking one plan up by id across the catalog — a first page could miss it.
  const plans = usePlans({ pageSize: MAX_PAGE_SIZE });
  const plan = plans.data?.items.find((p) => p.id === id);

  return (
    <PageLayout title="Edit plan" subtitle={`Editing “${id}”.`}>
      <div className=" space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => router.push("/subscription-plans")}>
          <ArrowLeft className="size-4" />
          Back
        </Button>

        {plans.isPending && <Skeleton skeleton="profile" />}
        {plans.isError && (
          <ErrorState
            title="Couldn't load the plan catalog"
            description={getErrorMessage(plans.error)}
            onRetry={() => plans.refetch()}
            retrying={plans.isFetching}
          />
        )}
        {plans.data && !plan && (
          <EmptyState
            icon={SearchX}
            title="Plan not found"
            description={`No plan in the catalog has the id “${id}”. It may have been deleted since this link was opened.`}
            action={
              <Button variant="outline" size="sm" onClick={() => router.push("/subscription-plans")}>
                Back to plans
              </Button>
            }
          />
        )}
        {plan && <PlanForm initial={plan} onDone={() => router.push("/subscription-plans")} />}
      </div>
    </PageLayout>
  );
};

export default Page;
