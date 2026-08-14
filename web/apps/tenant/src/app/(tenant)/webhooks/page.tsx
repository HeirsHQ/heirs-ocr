"use client";

import { Webhook } from "lucide-react";

import { EmptyState, PageLayout } from "@heirs/ui";

const Page = () => (
  <PageLayout title="Webhooks" subtitle="Configure webhook endpoints for event notifications.">
    <EmptyState
      icon={Webhook}
      title="No webhooks configured"
      description="Add an endpoint to receive event notifications when documents are processed."
    />
  </PageLayout>
);

export default Page;
