"use client";

import { Loader, RotateCw, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

/**
 * The failed-to-load counterpart to {@link EmptyState}: an icon chip, a title that
 * names what failed, and the server's message as the description.
 *
 * It carries a title separate from the message because `getErrorMessage` returns a
 * bare sentence ("Could not reach the server") that says nothing about *what* was
 * being loaded — on a page firing several queries, the same sentence could belong to
 * any of them. The title supplies the subject; the description supplies the cause.
 *
 * `onRetry` is the point of the component. React Query hands back a `refetch`, so a
 * failed panel can recover in place instead of forcing a full page reload. Pass
 * `retrying` (the query's `isFetching`) to show the attempt in flight.
 *
 * Geometry matches EmptyState so the two read as one family; only the colour differs,
 * and it stays a tint rather than a full red panel — a failed query is a state to
 * recover from, not an alarm.
 */
export const ErrorState = ({
  icon: Icon = TriangleAlert,
  title = "Something went wrong",
  description,
  onRetry,
  retryLabel = "Try again",
  retrying = false,
  action,
  variant = "panel",
  className,
}: {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  action?: ReactNode;
  variant?: "panel" | "inline";
  className?: string;
}) => (
  <div
    role="alert"
    className={cn(
      "flex flex-col items-center px-6 py-14 text-center",
      variant === "panel" && "rounded-lg border border-destructive/25 bg-destructive/5",
      className,
    )}
  >
    <span className="mb-4 flex size-12 items-center justify-center rounded-full border border-destructive/20 bg-destructive/10 text-destructive">
      <Icon className="size-5" strokeWidth={1.75} aria-hidden />
    </span>
    <p className="text-sm font-semibold tracking-tight">{title}</p>
    {description && (
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>
    )}
    {(onRetry || action) && (
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
            {retrying ? <Loader className="animate-spin" /> : <RotateCw />}
            {retrying ? "Retrying…" : retryLabel}
          </Button>
        )}
        {action}
      </div>
    )}
  </div>
);
