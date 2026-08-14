"use client";

import { ScrollText } from "lucide-react";

import { EmptyState, PageLayout } from "@heirs/ui";

const Page = () => (
  <PageLayout title="Logs" subtitle="Inspect request and processing logs for your tenant.">
    <EmptyState
      icon={ScrollText}
      title="No logs yet"
      description="Request and processing logs will appear here once you start running documents."
    />
  </PageLayout>
);

export default Page;
