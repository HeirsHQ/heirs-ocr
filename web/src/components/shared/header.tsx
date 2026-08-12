"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { useTenantLogout, useTenantMe } from "@/hooks/api/use-tenant-auth";
import { useLogout, useMe } from "@/hooks/api/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "../ui/badge";

export const Header = ({ area }: { area: "admin" | "tenant" }) =>
  area === "admin" ? <AdminHeader /> : <TenantHeader />;

const Shell = ({
  name,
  subtitle,
  onSignOut,
  pending,
}: {
  name?: string;
  subtitle?: string;
  onSignOut: () => void;
  pending: boolean;
}) => (
  <header className="h-14 w-full p-4 flex justify-between items-center border-b">
    <div />
    {name && (
      <div className="flex items-center gap-3">
        <div className="text-right leading-tight">
          <p className="text-sm font-medium">{name}</p>
        </div>
        {subtitle && (
          <Badge className="text-xs text-muted-foreground capitalize" variant="outline">
            {subtitle}
          </Badge>
        )}
        <Button variant="ghost" size="sm" onClick={onSignOut} disabled={pending} aria-label="Sign out">
          <LogOut className="size-4" />
        </Button>
      </div>
    )}
  </header>
);

const AdminHeader = () => {
  const router = useRouter();
  const { data: session } = useMe();
  const logout = useLogout();
  return (
    <Shell
      name={session?.user.name}
      subtitle={session?.role}
      pending={logout.isPending}
      onSignOut={() => logout.mutate(undefined, { onSuccess: () => router.replace("/admin/login") })}
    />
  );
};

const TenantHeader = () => {
  const router = useRouter();
  const { data: session } = useTenantMe();
  const logout = useTenantLogout();
  return (
    <Shell
      name={session?.user.name}
      subtitle={session?.role}
      pending={logout.isPending}
      onSignOut={() => logout.mutate(undefined, { onSuccess: () => router.replace("/login") })}
    />
  );
};
