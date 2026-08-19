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
  Row,
  RowData,
  RowSelectionState,
  SortingState,
  Updater,
} from "@tanstack/react-table";

import type { LucideIcon } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { SearchX } from "lucide-react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { EmptyState } from "./empty-state";
import { Pagination } from "./pagination";
import { cn } from "../../lib/utils";

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

/**
 * Whether a click or keypress came from something that handles its own activation.
 *
 * Rows carrying an action menu, a selection checkbox or a link would otherwise fire
 * the row handler *as well* — so opening the row menu would also navigate away, and
 * "Delete" would delete and then leave the page. Walking up to the row catches the
 * case where the event target is an icon or span nested inside the real control.
 */
const isInteractiveTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  !!target.closest('button, a, input, select, textarea, label, [role="menuitem"], [role="checkbox"]');

export type DataTableFeatures = typeof dataTableFeatures;

/**
 * A column set that also carries its row-click handler.
 *
 * Row rendering lives here, in {@link DataTable} — a column definition cannot attach
 * a handler to the `<tr>` it is rendered inside. But the natural place to *declare*
 * row behaviour is the column factory, next to the row's action menu and its
 * selection checkbox, so `createColumns` returns the array with the handler attached
 * and {@link DataTable} picks it up. Passing `onRowClick` directly to `DataTable`
 * still wins, for the one-off case.
 *
 * A plain `ColumnDef[]` remains valid — the property is optional.
 */
export type ColumnsWithRowClick<TData extends RowData> = ColumnDef<DataTableFeatures, TData, unknown>[] & {
  onRowClick?: (row: Row<DataTableFeatures, TData>) => void;
};

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
   * Makes rows clickable — typically to open the record's detail page.
   *
   * Clicks originating from something interactive inside the row (the action menu, a
   * checkbox, a link, a button) are **ignored**: without that, hitting "Delete" in the
   * row menu would also navigate, which is the classic way this feature goes wrong.
   *
   * When provided, rows also become keyboard-operable — focusable, and activated by
   * Enter or Space — because a click handler on a `<tr>` is otherwise unreachable
   * without a mouse.
   */
  onRowClick?: (row: Row<Features, TData>) => void;
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
  onRowClick,
  empty,
}: Props<TData>) => {
  // An explicit prop beats whatever `createColumns` attached, so a page can override
  // the factory's default for one table without rebuilding its columns.
  const handleRowClick = onRowClick ?? (columns as Partial<ColumnsWithRowClick<TData>>).onRowClick;

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
                <TableHead
                  key={header.id}
                  className="text-primary text-sm font-medium first:rounded-tl-lg last:rounded-tr-lg"
                >
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
                className={cn("data-[state=selected]:bg-primary/10 h-14", handleRowClick && "cursor-pointer")}
                // Only announced as a control when it actually is one — a plain table
                // row must not claim to be a button to a screen reader.
                {...(handleRowClick
                  ? {
                      role: "button",
                      tabIndex: 0,
                      onClick: (event: MouseEvent<HTMLTableRowElement>) => {
                        if (!isInteractiveTarget(event.target)) handleRowClick(row);
                      },
                      onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        if (isInteractiveTarget(event.target)) return;
                        // Space would otherwise scroll the page out from under them.
                        event.preventDefault();
                        handleRowClick(row);
                      },
                    }
                  : {})}
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
