"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageLayout } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { PlanForm } from "@/components/admin/plan-form";
import { usePlans } from "@/hooks/api/use-admin-plans";
import { getErrorMessage } from "@/lib/client";

const Page = ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = use(params);
  const router = useRouter();
  const plans = usePlans();
  const plan = plans.data?.plans.find((p) => p.id === id);

  return (
    <PageLayout title="Edit plan" subtitle={`Editing “${id}”.`}>
      <div className=" space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => router.push("/subscriptions")}>
          <ArrowLeft className="size-4" />
          Back
        </Button>

        {plans.isPending && <p className="text-sm text-muted-foreground">Loading plan…</p>}
        {plans.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {getErrorMessage(plans.error)}
          </div>
        )}
        {plans.data && !plan && (
          <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            No plan with id “{id}”.
          </div>
        )}
        {plan && <PlanForm initial={plan} onDone={() => router.push("/subscriptions")} />}
      </div>
    </PageLayout>
  );
};

export default Page;
