import React from "react";

import { cn } from "@heirs/ui";

/**
 * The two building blocks the documentation pages are made of.
 *
 * They live here rather than in either page because the same body is rendered in
 * two places — the marketing site at `/api-reference` and the portal at
 * `/developer/api-reference` — and headings that drift between the two would be a
 * documentation bug that nothing catches.
 */

/** A titled, anchor-linkable block. The id is what a deep link points at. */
export const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <section id={id} className="scroll-mt-6 space-y-3">
    <h2 className="text-base font-semibold">{title}</h2>
    {children}
  </section>
);

export const Prose = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <p className={cn("text-sm text-pretty text-muted-foreground", className)}>{children}</p>
);
