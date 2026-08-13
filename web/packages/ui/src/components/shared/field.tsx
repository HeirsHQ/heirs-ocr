"use client";

import { useId, type ReactNode } from "react";

import { Label } from "../ui/label";
import { cn } from "../../lib/utils";

/**
 * Label + control + supporting text, used for every form control in both apps so
 * spacing and hierarchy don't drift page to page.
 *
 * `error` replaces `hint` when present rather than stacking beneath it: two lines
 * of small print under one input is where people stop reading, and the correction
 * is the only line that matters once something is wrong.
 *
 * The generated id is passed to the child through `renderControl` so the label is
 * genuinely associated with the control — including for `SelectOption`, which is a
 * button rather than a native input and so cannot be wrapped implicitly.
 */
export const Field = ({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
  renderControl,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Override the generated id when the control already has one. */
  htmlFor?: string;
  className?: string;
  children?: ReactNode;
  renderControl?: (id: string) => ReactNode;
}) => {
  const generated = useId();
  const id = htmlFor ?? generated;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && (
          <span aria-hidden className="text-destructive">
            *
          </span>
        )}
      </Label>
      {renderControl ? renderControl(id) : children}
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : (
        hint && <p className="text-muted-foreground text-xs text-pretty">{hint}</p>
      )}
    </div>
  );
};
