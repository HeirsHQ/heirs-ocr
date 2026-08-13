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

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
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
    <div className="w-full">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="text-primary text-sm font-medium">
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
                className="data-[state=selected]:bg-primary/25 data-[state=selected]:text-secondary-200 h-14"
              >
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className="whitespace-nowrap">
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-125 text-center">
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {total > pageSize && (
        <div className="border-t">

          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} showPageSizeChange={showPageSizeChange} />
        </div>
      )}
    </div>
  );
};
