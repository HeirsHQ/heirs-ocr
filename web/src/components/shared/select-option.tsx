"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Option } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  onValueChange: (value: string) => void;
  options: Option[];
  className?: string;
  placeholder?: string;
  value?: string;
}

export const SelectOption = ({ onValueChange, options, className, placeholder, value }: Props) => {
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
