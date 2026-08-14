import { cn } from "../../lib/utils";

/**
 * What a status means operationally, not what colour it is. Call sites map their
 * own vocabulary (`past_due`, `degraded`, `failed`) onto these four, so the colour
 * of a given state is decided once here instead of per table.
 */
export type StatusTone = "healthy" | "pending" | "attention" | "failed" | "inactive";

const TONE: Record<StatusTone, { dot: string; text: string; ring: string }> = {
  healthy: { dot: "bg-success", text: "text-foreground", ring: "border-success/30 bg-success/10" },
  pending: { dot: "bg-primary", text: "text-foreground", ring: "border-primary/30 bg-primary/10" },
  attention: { dot: "bg-warning", text: "text-foreground", ring: "border-warning/40 bg-warning/10" },
  failed: { dot: "bg-destructive", text: "text-foreground", ring: "border-destructive/40 bg-destructive/10" },
  inactive: { dot: "bg-muted-foreground/50", text: "text-muted-foreground", ring: "border-border bg-muted/50" },
};

/**
 * A status as a dot plus a word. The dot does the scanning work down a column; the
 * word does the reading. Colour is never the only carrier — the label is always
 * present, so the state survives greyscale and colour-blindness.
 */
export const StatusBadge = ({
  tone,
  label,
  className,
}: {
  tone: StatusTone;
  label: string;
  className?: string;
}) => {
  const t = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap capitalize",
        t.ring,
        t.text,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", t.dot)} />
      {label}
    </span>
  );
};
