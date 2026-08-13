import type { ReactNode } from "react";

/** A compact label + value card, shared by the observability pages. */
export const StatTile = ({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <div className="rounded-md border p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
  </div>
);
