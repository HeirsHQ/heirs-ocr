import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

import { cn } from "../../lib/utils";

/**
 * Consistent empty / zero-data state: a tokened icon chip, a short title, a
 * description that says what would appear here (or how to make it appear), and an
 * optional action slot.
 *
 * The chip is a filled disc outlined in the app's hairline rather than a bare glyph:
 * at this size a lone muted icon reads as a rendering artefact, while a bounded chip
 * reads as a deliberate mark. The icon is drawn at a lighter stroke so the chip stays
 * quiet next to real content.
 *
 * `variant="inline"` drops the dashed frame for use inside something that already
 * has one (a table body, a card). Two nested borders look like a bug.
 */
export const EmptyState = ({
  icon: Icon = Inbox,
  title,
  description,
  action,
  variant = "panel",
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "panel" | "inline";
  className?: string;
}) => (
  <div
    className={cn(
      "flex flex-col items-center px-6 py-14 text-center",
      variant === "panel" && "border-hairline rounded-lg border border-dashed",
      className,
    )}
  >
    <span className="border-hairline mb-4 flex size-12 items-center justify-center rounded-full border bg-(--surface-strong) text-muted-foreground">
      <Icon className="size-5" strokeWidth={1.75} aria-hidden />
    </span>
    <p className="text-sm font-semibold tracking-tight">{title}</p>
    {description && (
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>
    )}
    {action && <div className="mt-5">{action}</div>}
  </div>
);
