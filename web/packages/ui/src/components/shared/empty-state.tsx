import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

/**
 * Consistent empty / zero-data state: a tokened icon chip, a short title, an
 * optional one-line description, and an optional action slot. Reserves comfortable
 * vertical space so a section doesn't collapse when there's nothing to show.
 */
export const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "border-hairline flex flex-col items-center gap-2 rounded-md border border-dashed px-6 py-12 text-center",
      className,
    )}
  >
    <span className="flex size-10 items-center justify-center rounded-full bg-(--surface-strong) text-muted-foreground">
      <Icon className="size-5" />
    </span>
    <p className="text-sm font-medium">{title}</p>
    {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
    {action && <div className="mt-1">{action}</div>}
  </div>
);
