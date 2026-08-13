"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
  title: string;
  actions?: React.ReactNode;
  subtitle?: string;
}

/**
 * Standard page frame: a titled header with an action slot, then the content.
 *
 * The header carries real hierarchy — the title outweighs the subtitle in size,
 * weight, and colour — because every page in the console looked alike when both
 * lines were the same size and the title was only a shade darker.
 */
export const PageLayout = ({ children, title, actions, subtitle }: Props) => {
  return (
    <div className="flex h-full flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
          {subtitle && <p className="text-muted-foreground max-w-prose text-sm text-pretty">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="min-h-0 w-full flex-1">{children}</div>
    </div>
  );
};
