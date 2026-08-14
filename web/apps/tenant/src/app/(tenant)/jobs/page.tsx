"use client";

import { ListTodo } from "lucide-react";

import { EmptyState, PageLayout } from "@heirs/ui";

const Page = () => (
  <PageLayout title="Job Queues" subtitle="Monitor and manage async OCR processing jobs.">
    <EmptyState
      icon={ListTodo}
      title="No jobs queued"
      description="Async jobs appear here when a document is too large to process inline."
    />
  </PageLayout>
);

export default Page;
