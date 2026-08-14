"use client";

import { FileText } from "lucide-react";

import { EmptyState, PageLayout } from "@heirs/ui";

const Page = () => (
  <PageLayout title="Documents" subtitle="Manage and organize your processed documents.">
    <EmptyState
      icon={FileText}
      title="No documents yet"
      description="Documents processed through the OCR API will appear here."
    />
  </PageLayout>
);

export default Page;
