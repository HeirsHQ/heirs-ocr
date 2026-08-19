"use client";

import { useState } from "react";

import type { PaginatedParams } from "../types";

/** Rows per page before the viewer changes it. Independent of the API's own default. */
export const DEFAULT_PAGE_SIZE = 10;

/**
 * Page state for a server-paginated list.
 *
 * Returns the params to hand the query hook and the props to spread onto
 * {@link DataTable}, so a page wires pagination in two lines and every table in both
 * apps behaves the same way:
 *
 * ```tsx
 * const { params, tableProps } = usePagination();
 * const tenants = useTenants(params);
 * <DataTable columns={c} data={tenants.data?.items ?? []} total={tenants.data?.total ?? 0} {...tableProps} />
 * ```
 */
export const usePagination = (initial?: PaginatedParams) => {
  const [page, setPage] = useState(initial?.page ?? 1);
  const [pageSize, setPageSize] = useState(initial?.pageSize ?? DEFAULT_PAGE_SIZE);

  return {
    params: { page, pageSize },
    /** Jump back to the first page — call after a filter changes, or the viewer can sit past the end of a now-shorter list. */
    reset: () => setPage(1),
    tableProps: {
      page,
      pageSize,
      onPageChange: setPage,
      // Resizing re-cuts the whole list, so "page 5" no longer means anything the
      // viewer chose; land them at the top rather than at an arbitrary new offset.
      onPageSizeChange: (next: number) => {
        setPageSize(next);
        setPage(1);
      },
    },
  };
};
