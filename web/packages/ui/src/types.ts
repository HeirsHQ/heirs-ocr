import { LucideIcon } from "lucide-react";

export interface Option {
  label: string;
  value: string;
  disabled?: boolean;
  icon?: LucideIcon;
}

export interface PaginatedParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface HttpResponse<T> {
  data: T;
}

/** Mirrors `Paginated<T>` in @heirs/api-client; duplicated because this package
 *  deliberately has no dependency on the API client. */
export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
