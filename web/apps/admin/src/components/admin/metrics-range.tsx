"use client";

import { cn } from "@/components/shared";

/**
 * The time-range control over the request-log charts, shared by the analytics page
 * and the tenant detail page.
 *
 * Presets rather than a free date picker: the bucket the endpoint returns is chosen
 * from the window (hourly up to 48h, daily beyond), so an arbitrary range would let a
 * reader pick one that renders as a thousand unreadable hour ticks.
 */
export const RANGES = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
] as const;

export const DEFAULT_RANGE_HOURS = RANGES[0].hours;

export const RangeToggle = ({
  hours,
  onChange,
  className,
}: {
  hours: number;
  onChange: (hours: number) => void;
  className?: string;
}) => (
  <div className={cn("bg-muted flex w-fit shrink-0 items-center rounded-md p-1", className)}>
    {RANGES.map((range) => (
      <button
        key={range.hours}
        onClick={() => onChange(range.hours)}
        aria-pressed={hours === range.hours}
        className={cn(
          "rounded-md px-3 py-1 text-sm",
          hours === range.hours ? "bg-primary text-white" : "text-muted-foreground",
        )}
      >
        {range.label}
      </button>
    ))}
  </div>
);
