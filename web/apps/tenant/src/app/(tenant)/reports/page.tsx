"use client";

import { BarChart2 } from "lucide-react";

import { EmptyState, PageLayout } from "@heirs/ui";

const Page = () => (
  <PageLayout title="Reports" subtitle="Generate and view reports on OCR processing activity.">
    <EmptyState
      icon={BarChart2}
      title="No reports yet"
      description="Reports on your OCR activity will appear here once you start processing documents."
    />
  </PageLayout>
);

export default Page;
