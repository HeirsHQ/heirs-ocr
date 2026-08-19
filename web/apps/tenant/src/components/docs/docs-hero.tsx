import { Badge } from "@heirs/ui";
import type { LucideIcon } from "lucide-react";

/**
 * Page header for the marketing copies of the documentation.
 *
 * The portal renders the same bodies under `PageLayout`, which is sized for a
 * console sitting inside the app shell. On the public site these pages are landing
 * pages in their own right and are reached from the footer and the hero CTA, so
 * they take the same full-bleed banner as the rest of the marketing site.
 */
export const DocsHero = ({
  eyebrow,
  icon: Icon,
  title,
  subtitle,
}: {
  eyebrow: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) => (
  <section className="relative overflow-hidden border-b bg-linear-to-b from-background to-muted/30">
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
      <Badge variant="outline" className="mb-6 gap-1.5">
        <Icon className="size-3" /> {eyebrow}
      </Badge>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{subtitle}</p>
    </div>
  </section>
);
