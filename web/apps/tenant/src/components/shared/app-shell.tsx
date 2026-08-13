import React from "react";

import { Header } from "./header";
import { Sidebar } from "./sidebar";
import type { Area } from "@/config/route";

interface Props {
  area: Area;
  children: React.ReactNode;
}

/** Sidebar + header chrome shared by the admin and tenant areas; each supplies its own area. */
export const AppShell = ({ area, children }: Props) => (
  <div className="w-screen h-screen overflow-hidden flex">
    <Sidebar area={area} />
    <div className="h-full flex-1 min-w-0">
      <Header />
      <div className="h-[calc(100dvh-3.5rem)] w-full overflow-y-auto p-4">{children}</div>
    </div>
  </div>
);
