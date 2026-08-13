"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ADMIN_ROUTES, TENANT_ROUTES, type Area } from "@/config/route";
import { cn } from "@heirs/ui";

export const Sidebar = ({ area }: { area: Area }) => {
  const pathname = usePathname();
  const routes = area === "tenant" ? TENANT_ROUTES : ADMIN_ROUTES;

  return (
    <aside className="w-60 h-full border-r">
      <div className="h-14 w-full px-4 flex items-center font-semibold border-b">Heirs OCR</div>
      <div className="h-[calc(100dvh-3.5rem)] w-full flex flex-col justify-between">
        <nav className="min-h-0 space-y-4 overflow-y-auto px-4 py-2">
          {routes.map((group, i) => (
            <div className="space-y-1" key={group.name || i}>
              {group.name ? <p className="px-3 text-[10px] text-muted-foreground uppercase">{group.name}</p> : null}
              <div className="space-y-1">
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
                        "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
                        route.disabled && "pointer-events-none opacity-50",
                      )}
                    >
                      {Icon ? <Icon className="size-4 shrink-0" /> : null}
                      <span>{route.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t px-4"></div>
      </div>
    </aside>
  );
};
