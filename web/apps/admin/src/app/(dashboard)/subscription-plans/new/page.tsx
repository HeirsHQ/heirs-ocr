"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageLayout } from "@/components/shared";
import { Button } from "@heirs/ui";
import { PlanForm } from "@/components/admin/plan-form";

const Page = () => {
  const router = useRouter();
  return (
    <PageLayout title="New plan" subtitle="Define a catalog plan — billing, entitlements, limits, and trial.">
      <div className=" space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => router.push("/subscriptions")}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <PlanForm onDone={() => router.push("/subscriptions")} />
      </div>
    </PageLayout>
  );
};

export default Page;
