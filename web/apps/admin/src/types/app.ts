import { LucideIcon } from "lucide-react";

export interface Option {
  label: string;
  value: string;
  disabled?: boolean;
  icon?: LucideIcon;
}

export interface HttpResponse<T> {
  data: T;
}

// The list envelope and its query params are the API's shape, so they live with the
// API client; re-exported here so `@/types` stays the one import for page code.
export type { Paginated, PaginatedParams } from "@heirs/api-client";
