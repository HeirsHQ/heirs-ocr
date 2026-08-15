"use client";

import { useState } from "react";
import {
  columnFilteringFeature,
  columnOrderingFeature,
  createFilteredRowModel,
  createSortedRowModel,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type {
  ColumnDef,
  ColumnFiltersState,
  ColumnOrderState,
  RowData,
  RowSelectionState,
  SortingState,
  Updater,
} from "@tanstack/react-table";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SearchX } from "lucide-react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { EmptyState } from "./empty-state";
import { Pagination } from "./pagination";

/**
 * The feature set this table registers (v9 requires explicit registration). Exported
 * so callers can type their columns against it: `ColumnDef<typeof dataTableFeatures, Row>`
 * or `createColumnHelper<typeof dataTableFeatures, Row>()`.
 */
export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  rowSortingFeature,
  rowSelectionFeature,
  columnOrderingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
});

export type DataTableFeatures = typeof dataTableFeatures;

type Features = DataTableFeatures;

interface Props<TData extends RowData> {
  // A columns array holds columns with heterogeneous value types, so the element
  // `TValue` is `unknown` (matching what `useTable` expects); build them with a
  // `createColumnHelper<typeof dataTableFeatures, TData>()` to keep per-column typing.
  columns: ColumnDef<Features, TData, unknown>[];
  data: TData[];
  total: number;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  page?: number;
  pageSize?: number;
  rowSelection?: RowSelectionState;
  showPageSizeChange?: boolean;
  /**
   * What to show when the body has no rows. The default speaks to the *filtered*
   * case ("nothing matches"), which is what a table normally hits: pages branch on
   * a zero-length dataset before they get here and render their own `EmptyState`
   * with the domain's wording and its "create the first one" action.
   */
  empty?: {
    icon?: LucideIcon;
    title?: string;
    description?: string;
    action?: ReactNode;
  };
}

export const DataTable = <TData extends RowData>({
  columns,
  data,
  total,
  onPageChange,
  onPageSizeChange,
  page = 1,
  pageSize = 10,
  showPageSizeChange = true,
  onRowSelectionChange,
  rowSelection: externalRowSelection,
  empty,
}: Props<TData>) => {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>({});

  const rowSelection = externalRowSelection ?? internalRowSelection;

  const handleRowSelectionChange = (updaterOrValue: Updater<RowSelectionState>) => {
    const next = typeof updaterOrValue === "function" ? updaterOrValue(rowSelection) : updaterOrValue;
    if (onRowSelectionChange) onRowSelectionChange(next);
    else setInternalRowSelection(next);
  };

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    state: { columnFilters, columnOrder, rowSelection, sorting },
    onColumnFiltersChange: setColumnFilters,
    onColumnOrderChange: setColumnOrder,
    onSortingChange: setSorting,
    onRowSelectionChange: handleRowSelectionChange,
  });

  return (
    <div className="w-full border rounded-lg">
      <Table>
        <TableHeader className="bg-muted rounded-t-lg">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow className="h-11" key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="text-primary text-sm font-medium first:rounded-tl-lg last:rounded-tr-lg">
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
                // `text-secondary-200` is not a token; selected rows fell back to default
                // text on a 25% primary wash. A lighter wash keeps contrast intact.
                className="data-[state=selected]:bg-primary/10 h-14"
              >
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className="whitespace-nowrap">
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow className="hover:bg-transparent">
              {/* `p-0` so the state owns its own padding — the cell's default inset
                  would push the block off-centre inside the table. */}
              <TableCell colSpan={columns.length} className="p-0">
                <EmptyState
                  variant="inline"
                  icon={empty?.icon ?? SearchX}
                  title={empty?.title ?? "No results"}
                  description={
                    empty?.description ??
                    "Nothing here matches the current filters. Try clearing them or searching for something broader."
                  }
                  action={empty?.action}
                />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {total > pageSize && (
        <div className="border-t">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            showPageSizeChange={showPageSizeChange}
          />
        </div>
      )}
    </div>
  );
};
