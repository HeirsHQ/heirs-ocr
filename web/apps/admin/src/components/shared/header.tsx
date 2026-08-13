"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { useLogout, useMe } from "@/hooks/api/use-auth";
import { Badge, Button } from "@heirs/ui";

/**
 * Admin console top bar: current user + sign-out.
 *
 * Sign-out renders whether or not the session resolves. It used to be nested
 * inside the `session?.user.name` check, so an expired session — the exact moment
 * you need to sign out and back in — removed the only control that could fix it,
 * and the bar sat empty on every page load until `useMe` settled.
 */
export const Header = () => {
  const router = useRouter();
  const { data: session, isPending } = useMe();
  const logout = useLogout();

  return (
    <header className="flex h-14 w-full shrink-0 items-center justify-end gap-3 border-b px-4">
      {isPending ? (
        <span className="bg-muted h-4 w-28 animate-pulse rounded" />
      ) : (
        session?.user.name && (
          <>
            <p className="text-sm leading-tight font-medium">{session.user.name}</p>
            {session.role && (
              <Badge variant="outline" className="text-muted-foreground capitalize">
                {session.role}
              </Badge>
            )}
          </>
        )
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => logout.mutate(undefined, { onSuccess: () => router.replace("/admin/login") })}
        disabled={logout.isPending}
        aria-label="Sign out"
      >
        <LogOut className="size-4" />
      </Button>
    </header>
  );
};
