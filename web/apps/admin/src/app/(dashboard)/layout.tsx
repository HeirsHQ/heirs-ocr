import React from "react";

import { AppShell } from "@/components/shared";

/** Admin console area — platform operators provisioning tenants and monitoring the service. */
const AdminLayout = ({ children }: { children: React.ReactNode }) => <AppShell area="admin">{children}</AppShell>;

export default AdminLayout;
