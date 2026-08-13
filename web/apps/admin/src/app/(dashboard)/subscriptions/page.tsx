"use client";

import { DataTable, PageLayout, StatTile } from "@/components/shared";

const Page = () => {
  return (
    <PageLayout title="Subscriptions" subtitle="Manage and monitor all tenant subscriptions and their current status">
      <div className=" space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <StatTile label="Total Revenue" value={0} />
          <StatTile label="" value={0} />
          <StatTile label="" value={0} />
          <StatTile label="" value={0} />
        </div>
        <DataTable columns={[]} data={[]} total={0} />
      </div>
    </PageLayout>
  );
};

export default Page;
