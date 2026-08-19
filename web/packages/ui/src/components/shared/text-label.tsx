"use client"

import { LucideIcon } from "lucide-react";

import { cn } from "../../lib/utils";

interface Props {
  label: string;
  value: React.ReactNode;
  className?: string;
  icon?: LucideIcon;
}

export const TextLabel = ({ label, value, className, icon}:Props) => {
  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium wrap-break-word">{value}</p>
    </div>
  )
}
