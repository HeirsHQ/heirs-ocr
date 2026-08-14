"use client";

import { ShieldCheck } from "lucide-react";

import { EmptyState, PageLayout } from "@heirs/ui";

const Page = () => (
  <PageLayout title="Security" subtitle="Manage 2FA, IP whitelisting, and session settings.">
    <EmptyState
      icon={ShieldCheck}
      title="No security settings configured"
      description="2FA, IP whitelisting, and session controls will be available here."
    />
  </PageLayout>
);

export default Page;
