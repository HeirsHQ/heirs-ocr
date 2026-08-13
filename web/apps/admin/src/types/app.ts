import { LucideIcon } from "lucide-react";

export interface Option {
  label: string;
  value: string;
  disabled?: boolean;
  icon?: LucideIcon;
}

export interface PaginatedParams {
  page: number;
  size: number;
  search?: string;
}

export interface HttpResponse<T> {
  data: T;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}
