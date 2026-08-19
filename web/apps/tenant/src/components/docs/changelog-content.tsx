import { ArrowUpRight, Bug, ShieldCheck, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { format, parseISO } from "date-fns";

import { CHANGELOG, type ChangeKind } from "@/config/changelog";
import { cn } from "@heirs/ui";

/**
 * How each kind reads at a glance. `security` is called out separately from
 * `improved` on purpose: a change to how sign-in works is something a reader may need
 * to act on, not merely something that got better.
 */
const KIND: Record<ChangeKind, { label: string; icon: LucideIcon; className: string }> = {
  added: { label: "New", icon: Sparkles, className: "bg-primary/10 text-primary" },
  improved: { label: "Improved", icon: ArrowUpRight, className: "bg-success/10 text-success" },
  fixed: { label: "Fixed", icon: Bug, className: "bg-warning/10 text-warning" },
  security: { label: "Security", icon: ShieldCheck, className: "bg-destructive/10 text-destructive" },
};

/**
 * `parseISO` on a bare date gives local midnight, and the format string is fixed.
 * Both matter because this list is server-rendered on the marketing site: a
 * locale- or zone-dependent format would render one date on the server and another
 * in the browser, which React reports as a hydration mismatch.
 */
const day = (iso: string): string => format(parseISO(iso), "d MMMM yyyy");

/** The release timeline. Shared by the marketing and portal changelog pages. */
export const ChangelogContent = () => (
  <div className="space-y-10">
    {CHANGELOG.map((release) => (
      <section key={release.date} className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        {/* Date rail: on wide screens the releases line up down the left, so the
            history is scannable without reading any of the entries. */}
        <div className="sm:pt-1">
          <p className="text-sm font-medium">{day(release.date)}</p>
          <p className="text-xs text-muted-foreground">{release.title}</p>
        </div>

        <ul className="space-y-3 border-l pl-4 sm:pl-6">
          {release.changes.map((change) => {
            const { label, icon: Icon, className } = KIND[change.kind];
            return (
              <li key={change.text} className="space-y-1.5">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    className,
                  )}
                >
                  <Icon className="size-3" />
                  {label}
                </span>
                {/* Entries carry inline code spans; rendered as plain text rather
                    than parsed, so a stray backtick can never break the page. */}
                <p className="text-sm text-pretty text-muted-foreground">{change.text}</p>
              </li>
            );
          })}
        </ul>
      </section>
    ))}
  </div>
);
