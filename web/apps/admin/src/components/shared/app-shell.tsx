import React from "react";

import { Header } from "./header";
import { Sidebar } from "./sidebar";
import type { Area } from "@/config/route";

interface Props {
  area: Area;
  children: React.ReactNode;
}

/**
 * Sidebar + header chrome shared by the admin and tenant areas; each supplies its
 * own area.
 *
 * The content column is the only scroller — the sidebar and header stay put — and
 * it is width-capped so tables and forms don't stretch to unreadable line lengths
 * on a wide monitor.
 */
export const AppShell = ({ area, children }: Props) => (
  <div className="bg-background flex h-screen w-screen overflow-hidden">
    <Sidebar area={area} />
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <Header />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[90rem] px-6 py-6">{children}</div>
      </main>
    </div>
  </div>
);
