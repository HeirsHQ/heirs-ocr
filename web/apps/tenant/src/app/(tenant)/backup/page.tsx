"use client";

import { HardDrive } from "lucide-react";

import { EmptyState, PageLayout } from "@heirs/ui";

const Page = () => (
  <PageLayout title="Backup" subtitle="Manage data backups and exports.">
    <EmptyState icon={HardDrive} title="No backups yet" description="Backup and export features are coming soon." />
  </PageLayout>
);

export default Page;
