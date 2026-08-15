"use client";

import { CSSProperties } from "react";
import { cn } from "../../lib/utils";

const Shimmer = ({ className, style }: { className?: string; style?: CSSProperties }) => (
  <div
    className={cn(
      "relative overflow-hidden rounded-md bg-muted",
      // The sweep band is the ::before layer. It needs an explicit content and is
      // positioned/animated with `transform` only (the @keyframes animates transform),
      // so it never conflicts with Tailwind v4's `translate`-property utilities.
      "before:absolute before:inset-0 before:content-['']",
      "before:bg-linear-to-r before:from-transparent before:via-white/60 before:to-transparent dark:before:via-white/10",
      "before:animate-[shimmer_1.6s_ease-in-out_infinite] motion-reduce:before:animate-none",
      className,
    )}
    style={style}
  />
);

const StatCardSkeleton = () => (
  <div className="bg-card border-border space-y-3 rounded-md border p-4">
    <div className="flex items-center justify-between">
      <Shimmer className="h-3 w-20" />
      <Shimmer className="size-4 rounded-full" />
    </div>
    <Shimmer className="h-7 w-28" />
    <div className="flex items-center gap-2">
      <Shimmer className="h-4 w-10 rounded-full" />
      <Shimmer className="h-3 w-24" />
    </div>
  </div>
);

const StatisticsSkeleton = ({ numberOfCards = 4 }: { numberOfCards?: number }) => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    {Array.from({ length: numberOfCards }, (_, i) => (
      <StatCardSkeleton key={i} />
    ))}
  </div>
);

const TableSkeleton = ({ columns = 6, rows = 8 }: { columns?: number; rows?: number }) => {
  const colWidths = ["w-8", "w-32", "w-24", "w-20", "w-28", "w-16"];

  return (
    <div className="bg-card border-border w-full overflow-hidden rounded-md border">
      <div className="border-border flex h-11 items-center gap-4 border-b bg-muted px-4">
        {Array.from({ length: columns }, (_, i) => (
          <Shimmer key={i} className={cn("h-3", colWidths[i % colWidths.length])} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={cn(
            "border-border flex h-12 items-center gap-4 border-b px-4 last:border-0",
            i % 2 === 0 ? "bg-card" : "bg-muted/40",
          )}
          style={{ animationDelay: `${i * 60}ms` }}
        >
          {Array.from({ length: columns }, (_, j) => (
            <Shimmer key={j} className={cn("h-3", colWidths[j % colWidths.length], j === 0 && "rounded-full")} />
          ))}
        </div>
      ))}
    </div>
  );
};

const WidgetSkeleton = ({ hasChart = false }: { hasChart?: boolean }) => (
  <div className="bg-card ring-foreground/10 flex flex-col gap-4 overflow-hidden rounded-md p-4 ring-1">
    <div className="flex items-center justify-between">
      <Shimmer className="h-4 w-32" />
      <div className="flex gap-1">
        <Shimmer className="size-7 rounded-md" />
        <Shimmer className="size-7 rounded-md" />
      </div>
    </div>
    {hasChart ? (
      <div className="space-y-2">
        <div className="flex h-40 items-end gap-1.5">
          {Array.from({ length: 7 }, (_, i) => (
            <Shimmer key={i} className="flex-1 rounded-md" style={{ height: `${30 + Math.sin(i) * 25 + 40}%` }} />
          ))}
        </div>
        <div className="flex justify-between">
          {Array.from({ length: 7 }, (_, i) => (
            <Shimmer key={i} className="h-2.5 w-6" />
          ))}
        </div>
      </div>
    ) : (
      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Shimmer className="size-7 rounded-full" />
              <div className="space-y-1.5">
                <Shimmer className="h-3 w-28" />
                <Shimmer className="h-2.5 w-16" />
              </div>
            </div>
            <Shimmer className="h-3 w-12" />
          </div>
        ))}
      </div>
    )}
  </div>
);

const CourseCardSkeleton = () => (
  <div className="border-border bg-card space-y-3 rounded-md border p-5">
    <Shimmer className="h-2.5 w-16" />
    <Shimmer className="h-4 w-3/4" />
    <Shimmer className="h-3 w-1/2" />
    <div className="space-y-1.5 pt-1">
      <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
        <Shimmer className="h-2 w-2/3 rounded-full" />
      </div>
      <Shimmer className="h-2.5 w-20" />
    </div>
  </div>
);

const DashboardSkeleton = () => (
  <div className="space-y-6">
    <StatisticsSkeleton numberOfCards={4} />
    <div className="grid gap-6 lg:grid-cols-2">
      <WidgetSkeleton hasChart={false} />
      <WidgetSkeleton hasChart={true} />
    </div>
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Shimmer className="h-5 w-36" />
        <Shimmer className="h-8 w-24 rounded-md" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <CourseCardSkeleton />
        <CourseCardSkeleton />
        <CourseCardSkeleton />
      </div>
    </div>
  </div>
);

const PageSkeleton = () => (
  <div className="space-y-6">
    <div className="flex items-center justify-between">
      <div className="space-y-2">
        <Shimmer className="h-6 w-48" />
        <Shimmer className="h-3.5 w-72" />
      </div>
      <Shimmer className="h-8 w-28 rounded-md" />
    </div>
    <div className="border-border bg-card space-y-4 rounded-md border p-4">
      <div className="flex items-center gap-3">
        <Shimmer className="h-8 w-24 rounded-md" />
        <Shimmer className="h-8 w-24 rounded-md" />
        <Shimmer className="h-8 w-24 rounded-md" />
      </div>
      <TableSkeleton columns={5} rows={8} />
    </div>
  </div>
);

const ListSkeleton = ({ count = 6 }: { count?: number }) => (
  <div className="space-y-6">
    <div className="flex items-center justify-between">
      <Shimmer className="h-6 w-40" />
      <div className="flex gap-2">
        <Shimmer className="h-8 w-32 rounded-md" />
        <Shimmer className="h-8 w-8 rounded-md" />
      </div>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="bg-card border-border overflow-hidden rounded-md border"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <Shimmer className="h-36 w-full rounded-none" />
          <div className="space-y-2.5 p-4">
            <div className="flex items-center gap-2">
              <Shimmer className="h-4 w-14 rounded-full" />
              <Shimmer className="h-4 w-14 rounded-full" />
            </div>
            <Shimmer className="h-4 w-4/5" />
            <Shimmer className="h-3 w-full" />
            <Shimmer className="h-3 w-3/4" />
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <Shimmer className="size-6 rounded-full" />
                <Shimmer className="h-3 w-20" />
              </div>
              <Shimmer className="h-3 w-12" />
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

const ProfileSkeleton = () => (
  <div className="space-y-6">
    <div className="bg-card border-border flex items-center gap-5 rounded-md border p-6">
      <Shimmer className="size-16 rounded-full" />
      <div className="space-y-2">
        <Shimmer className="h-5 w-36" />
        <Shimmer className="h-3.5 w-48" />
      </div>
    </div>
    <div className="bg-card border-border space-y-5 rounded-md border p-6">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Shimmer className="h-3 w-24" />
          <Shimmer className="h-8 w-full rounded-md" />
        </div>
      ))}
      <Shimmer className="h-8 w-28 rounded-md" />
    </div>
  </div>
);

type SkeletonType = "dashboard" | "page" | "statistics" | "table" | "list" | "profile" | "widget";

interface Props {
  skeleton: SkeletonType;
  /** For statistics: number of stat cards */
  numberOfCards?: number;
  /** For table: number of columns */
  columns?: number;
  /** For table: number of rows */
  rows?: number;
  /** For list: number of cards */
  count?: number;
}

export const Skeleton = ({ skeleton, numberOfCards, columns, rows, count }: Props) => {
  switch (skeleton) {
    case "dashboard":
      return <DashboardSkeleton />;
    case "statistics":
      return <StatisticsSkeleton numberOfCards={numberOfCards} />;
    case "table":
      return <TableSkeleton columns={columns} rows={rows} />;
    case "list":
      return <ListSkeleton count={count} />;
    case "profile":
      return <ProfileSkeleton />;
    case "widget":
      return <WidgetSkeleton />;
    case "page":
    default:
      return <PageSkeleton />;
  }
};

export {
  Shimmer,
  StatCardSkeleton,
  StatisticsSkeleton,
  TableSkeleton,
  WidgetSkeleton,
  CourseCardSkeleton,
  ListSkeleton,
  ProfileSkeleton,
  PageSkeleton,
  DashboardSkeleton,
};
