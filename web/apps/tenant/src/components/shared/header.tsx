"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { useTenantLogout, useTenantMe } from "@/hooks/api/use-tenant-auth";
import { Badge, Button } from "@heirs/ui";

/** Tenant portal top bar: current user + sign-out. */
export const Header = () => {
  const router = useRouter();
  const { data: session } = useTenantMe();
  const logout = useTenantLogout();
  return (
    <header className="h-14 w-full p-4 flex justify-between items-center border-b">
      <div />
      {session?.user.name && (
        <div className="flex items-center gap-3">
          <div className="text-right leading-tight">
            <p className="text-sm font-medium">{session.user.name}</p>
          </div>
          {session.role && (
            <Badge className="text-xs text-muted-foreground capitalize" variant="outline">
              {session.role}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout.mutate(undefined, { onSuccess: () => router.replace("/login") })}
            disabled={logout.isPending}
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      )}
    </header>
  );
};
