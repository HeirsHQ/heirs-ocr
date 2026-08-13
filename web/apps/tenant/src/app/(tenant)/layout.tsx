import React from "react";

import { AppShell } from "@/components/shared";

/** Tenant portal area — an org runs OCR in-app and manages its own keys and team. */
const TenantLayout = ({ children }: { children: React.ReactNode }) => <AppShell area="tenant">{children}</AppShell>;

export default TenantLayout;
