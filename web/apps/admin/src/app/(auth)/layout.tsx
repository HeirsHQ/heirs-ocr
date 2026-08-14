import React from "react";

interface Props {
  children: React.ReactNode;
}

/**
 * Split sign-in: the product's premise on the left, the form on the right.
 *
 * The left panel is a stack of pages with their extracted fields pulled out
 * alongside — documents in, structured data out, which is the whole product in one
 * image. It replaces four rotated squares that were styled with `primary-50` and
 * `primary-300`, scales this theme never defined, so they rendered as invisible
 * transparent boxes.
 */
const AuthLayout = ({ children }: Props) => {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="bg-sidebar relative hidden flex-col justify-between border-r p-10 lg:flex">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold tracking-tight">Heirs</span>
          <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 font-mono text-[0.6875rem] font-semibold tracking-wider uppercase">
            OCR
          </span>
        </div>

        <div className="space-y-8">
          <h1 className="max-w-sm text-3xl font-semibold tracking-tight text-balance">
            Turn documents into data you can act on.
          </h1>
          <DocumentStack />
        </div>

        <p className="text-muted-foreground max-w-sm text-sm text-pretty">
          Receipts, statements, claims and IDs — read, checked, and returned as structured fields.
        </p>
      </aside>

      <main className="grid place-items-center p-6">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
};

/** A page being read, with the fields it yields lined up beside it. */
const DocumentStack = () => (
  <div className="relative h-56 w-full max-w-sm" aria-hidden>
    {/* Back sheets, offset to read as a stack. */}
    <div className="bg-card absolute top-3 left-4 h-44 w-36 rotate-[-6deg] rounded-md border shadow-sm" />
    <div className="bg-card absolute top-1 left-1 h-44 w-36 rotate-[-2deg] rounded-md border shadow-sm" />

    {/* Front sheet: ruled lines standing in for body text. */}
    <div className="bg-card absolute top-0 left-0 flex h-44 w-36 flex-col gap-2 rounded-md border p-3 shadow-md">
      <div className="bg-primary/25 h-1.5 w-14 rounded-full" />
      {[16, 20, 18, 22, 12, 19].map((w, i) => (
        <div key={i} className="bg-muted-foreground/20 h-1 rounded-full" style={{ width: `${w * 4}%` }} />
      ))}
    </div>

    {/* The extraction: mono key/value pairs, the shape of the actual result. */}
    <div className="bg-card absolute top-8 right-0 w-44 space-y-2 rounded-md border p-3 shadow-md">
      {[
        ["total", "₦48,250"],
        ["date", "2026-08-13"],
        ["vendor", "Acme Ltd"],
      ].map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground font-mono text-[0.625rem] tracking-wide">{k}</span>
          <span className="font-mono text-[0.6875rem] tabular-nums">{v}</span>
        </div>
      ))}
    </div>
  </div>
);

export default AuthLayout;
