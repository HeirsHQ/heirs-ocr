import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

/** State a figure can carry. `notable` is for a number worth looking at, not a fault. */
export type StatTone = "default" | "notable" | "success" | "warning" | "critical";

const RULE: Record<StatTone, string> = {
  default: "bg-border",
  notable: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  critical: "bg-destructive",
};

const VALUE: Record<StatTone, string> = {
  default: "text-foreground",
  notable: "text-foreground",
  success: "text-foreground",
  warning: "text-warning",
  critical: "text-destructive",
};

/**
 * A single figure, set like a column on a statement: a rule, then the label, then
 * the number. The rule is the one place the tile carries colour — a tile only turns
 * amber or red when the number itself is the problem, so a wall of tiles stays
 * scannable and the exception is the thing you see first.
 *
 * The value is monospaced and tabular: these are counts, money, and ids that get
 * compared down a column, and proportional digits make that harder than it needs
 * to be.
 */
export const StatTile = ({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: StatTone;
  className?: string;
}) => (
  <div className={cn("bg-card border-hairline flex flex-col gap-2 rounded-lg border p-4", className)}>
    <span aria-hidden className={cn("h-0.5 w-8 rounded-full", RULE[tone])} />
    <p className="text-muted-foreground text-[0.6875rem] font-medium tracking-wider uppercase">{label}</p>
    <p className={cn("font-mono text-3xl leading-none font-semibold tracking-tight tabular-nums", VALUE[tone])}>
      {value}
    </p>
    {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
  </div>
);
