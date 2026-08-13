"use client";

import { use } from "react";

import { PageLayout } from "@/components/shared";

const Page = ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = use(params);

  return (
    <PageLayout title="Edit plan" subtitle={`Editing “${id}”.`}>
      <div className=" space-y-6"></div>
    </PageLayout>
  );
};

export default Page;
