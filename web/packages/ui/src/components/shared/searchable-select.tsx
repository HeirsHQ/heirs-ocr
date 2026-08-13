"use client";

import { useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Option, PaginatedResponse } from "../../types";
import { cn } from "../../lib/utils";

interface Props<T extends object> {
  onSearch: (value: string) => Promise<PaginatedResponse<T>>;
  onValueChange: (value: string) => void;
  options: Option[];
  className?: string;
  placeholder?: string;
  value?: string;
}

export const SearchableSelect = <T extends object>({
  onValueChange,
  options,
  className,
  placeholder,
  value,
}: Props<T>) => {
  const [] = useState("");

  return (
    <Select onValueChange={onValueChange} value={value}>
      <SelectTrigger className={cn("", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.value}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
