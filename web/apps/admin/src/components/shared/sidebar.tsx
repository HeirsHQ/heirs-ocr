"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ADMIN_ROUTES, TENANT_ROUTES, type Area } from "@/config/route";
import { cn } from "@heirs/ui";

/**
 * Primary navigation.
 *
 * The active item is marked with a filled left rule rather than a background wash
 * alone — the same rule device the stat tiles use — so position in the tree stays
 * readable at a glance down a long grouped list.
 */
export const Sidebar = ({ area }: { area: Area }) => {
  const pathname = usePathname();
  const routes = area === "tenant" ? TENANT_ROUTES : ADMIN_ROUTES;

  return (
    <aside className="bg-sidebar text-sidebar-foreground flex h-full w-60 flex-col border-r">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <span className="text-base font-semibold tracking-tight">Heirs</span>
        <span className="bg-primary/10 text-primary rounded font-mono text-[0.6875rem] font-semibold tracking-wider uppercase px-1.5 py-0.5">
          OCR
        </span>
      </div>

      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {routes.map((group, i) => (
          <div className="space-y-1" key={group.name || i}>
            {group.name ? (
              <p className="text-muted-foreground px-3 pb-1 text-[0.625rem] font-medium tracking-wider uppercase">
                {group.name}
              </p>
            ) : null}
            {group.routes.map((route) => {
              const active = pathname === route.href || pathname.startsWith(`${route.href}/`);
              const Icon = route.icon;
              return (
                <Link
                  key={route.href}
                  href={route.disabled ? "#" : route.href}
                  aria-disabled={route.disabled}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex items-center gap-2.5 rounded-md py-2 pr-3 pl-4 text-sm transition-colors",
                    "before:absolute before:top-1/2 before:left-0 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium before:bg-primary"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground before:bg-transparent",
                    route.disabled && "pointer-events-none opacity-50",
                  )}
                >
                  {Icon ? <Icon className="size-4 shrink-0" /> : null}
                  <span className="truncate">{route.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Names the surface you're on — the two apps are near-identical shells on
          different origins, and operators run both side by side. */}
      <div className="text-muted-foreground shrink-0 border-t px-4 py-3 text-xs">
        {area === "tenant" ? "Tenant portal" : "Admin console"}
      </div>
    </aside>
  );
};
