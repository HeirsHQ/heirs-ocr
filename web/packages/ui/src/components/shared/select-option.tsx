"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Option } from "../../types";
import { cn } from "../../lib/utils";

/**
 * The single select control used across both apps — always this, never a native
 * `<select>`, so keyboard behaviour, dark mode, and trigger styling stay identical
 * everywhere.
 *
 * `Option.label` is what the user reads; `Option.value` is what travels to the API.
 * (This previously rendered `value` in the list, so a caller's carefully written
 * labels never appeared and users saw raw enum keys.)
 */
interface Props {
  onValueChange: (value: string) => void;
  options: Option[];
  className?: string;
  placeholder?: string;
  value?: string;
  disabled?: boolean;
  /** Forwarded to the trigger so a `<Label htmlFor>` can point at it. */
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  /** Trigger height, matching the shadcn Select sizes. */
  size?: "sm" | "default";
}

export const SelectOption = ({
  onValueChange,
  options,
  className,
  placeholder,
  value,
  disabled,
  id,
  size = "default",
  ...aria
}: Props) => {
  return (
    <Select onValueChange={onValueChange} value={value} disabled={disabled}>
      <SelectTrigger id={id} size={size} className={cn("w-full", className)} {...aria}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {Icon && <Icon className="size-4 text-muted-foreground" />}
              {option.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};
