"use client";

import { DollarSign } from "lucide-react";

import { EmptyState, PageLayout, Skeleton, StatTile } from "@heirs/ui";

const isPending = false;

const Page = () => (
  <PageLayout title="Billing & Usage" subtitle="View your current subscription, usage statistics, and invoices.">
    <div className="space-y-6">
      {isPending ? (
        <Skeleton skeleton="table" columns={5} rows={6} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            <StatTile label="" value={0} />
            <StatTile label="" value={0} />
            <StatTile label="" value={0} />
            <StatTile label="" value="0" />
          </div>
          <EmptyState
            icon={DollarSign}
            title="No billing and usage data yet"
            description="Assign a plan to a tenant from the Tenants page to enrol them."
          />
        </>
      )}
    </div>
  </PageLayout>
);

export default Page;
