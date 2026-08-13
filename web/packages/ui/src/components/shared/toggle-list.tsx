"use client";

import { Checkbox } from "../ui/checkbox";

/** A wrapped set of checkboxes backing a string[] value — used for features, functions, etc. */
export const ToggleList = <T extends string>({
  options,
  selected,
  onToggle,
  columns = 3,
}: {
  options: readonly T[];
  selected: T[];
  onToggle: (value: T) => void;
  columns?: 2 | 3;
}) => (
  <div className={columns === 2 ? "grid grid-cols-2 gap-1.5" : "grid grid-cols-2 gap-1.5 sm:grid-cols-3"}>
    {options.map((opt) => (
      <label key={opt} className="flex items-center gap-2 text-sm">
        <Checkbox checked={selected.includes(opt)} onCheckedChange={() => onToggle(opt)} />
        <span className="truncate">{opt}</span>
      </label>
    ))}
  </div>
);
