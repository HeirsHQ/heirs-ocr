import { MoreVertical, type LucideIcon } from "lucide-react";
import type { ColumnDef, Row, RowData } from "@tanstack/react-table";
import { format, formatDistanceToNow } from "date-fns";
import { Fragment } from "react";
import Link from "next/link";

import type { ColumnsWithRowClick, DataTableFeatures } from "@heirs/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@heirs/ui";
import { SelectOption } from "@heirs/ui";
import { Checkbox } from "@heirs/ui";
import { cn, formatCurrency } from "@heirs/ui";
import { Button } from "@heirs/ui";

/** Column type accepted by {@link DataTable}: bound to its registered v9 feature set. */
export type Column<T extends RowData> = ColumnDef<DataTableFeatures, T, unknown>;

type TabelActionVariant = "amber" | "default" | "destructive" | "info" | "success" | "warning";

// Tokened so the menu is legible in dark mode; the previous fixed `gray-700`
// text on `gray-100` inverted into near-invisibility. `success` also referenced a
// `success-600` scale that was never defined, so those items rendered unstyled.
const variants: Record<TabelActionVariant, string> = {
  amber: "text-warning hover:bg-warning/10",
  default: "text-foreground hover:bg-accent",
  destructive: "text-destructive hover:bg-destructive/10",
  info: "text-primary hover:bg-primary/10",
  success: "text-success hover:bg-success/10",
  warning: "text-warning hover:bg-warning/10",
};

interface TableActionItem<T> {
  label: string;
  icon?: LucideIcon;
  hidden?: boolean | ((args: T) => boolean);
  href?: string | ((args: T) => string);
  onClick?: (args: T) => void;
  variant?: TabelActionVariant | (string & {});
}

interface CreateColumnsProps<T extends object> {
  columns: Column<T>[];
  /** Per-row action menu rendered in a trailing column. */
  actions?: (rowItem: T) => TableActionItem<T>[];
  actionColumnId?: string;
  actionColumnHeader?: string;
  /** Prefixed to relative `href`s returned by actions. */
  baseHref?: string;
  /**
   * Opens the row — usually its detail page. Declared here, beside the action menu
   * and the selection checkbox, but applied by {@link DataTable}, which owns the
   * `<tr>`: it ignores clicks that came from a control inside the row and adds
   * keyboard activation.
   */
  onRowClick?: (row: Row<DataTableFeatures, T>) => void;
  /** Prepends a checkbox column for row selection. */
  selectable?: boolean;
}

/** Resolves a value that may be given directly or as a function of the row. */
const resolve = <T, V>(value: V | ((args: T) => V) | undefined, args: T): V | undefined =>
  typeof value === "function" ? (value as (args: T) => V)(args) : value;

const RowActions = <T extends object>({
  row,
  items,
  baseHref,
}: {
  row: T;
  items: TableActionItem<T>[];
  baseHref?: string;
}) => {
  const visible = items.filter((item) => !resolve(item.hidden, row));
  if (visible.length === 0) return null;

  return (
    <div className="flex justify-end">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Row actions">
            <MoreVertical className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-44 gap-0.5 p-1">
          {visible.map((item, index) => {
            const Icon = item.icon;
            const href = resolve(item.href, row);
            const className = cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              variants[item.variant as TabelActionVariant] ?? variants.default,
            );
            const content = (
              <Fragment>
                {Icon && <Icon className="size-4" />}
                {item.label}
              </Fragment>
            );

            return href ? (
              <Link key={index} href={baseHref ? `${baseHref}${href}` : href} className={className}>
                {content}
              </Link>
            ) : (
              <Button
                key={index}
                type="button"
                variant="ghost"
                className={cn(className, "h-auto justify-start font-normal")}
                onClick={() => item.onClick?.(row)}
              >
                {content}
              </Button>
            );
          })}
        </PopoverContent>
      </Popover>
    </div>
  );
};

/**
 * Assembles a {@link DataTable}-ready column set: an optional leading selection
 * checkbox, the provided data columns, then an optional trailing action menu.
 */
export function createColumns<T extends object>({
  columns,
  actions,
  actionColumnId = "actions",
  actionColumnHeader = "",
  baseHref,
  onRowClick,
  selectable,
}: CreateColumnsProps<T>): ColumnsWithRowClick<T> {
  const result: Column<T>[] = [];

  if (selectable) {
    result.push({
      id: "select",
      enableSorting: false,
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
          onCheckedChange={(checked: boolean) => table.toggleAllPageRowsSelected(checked)}
          aria-label="Select all rows"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(checked: boolean) => row.toggleSelected(checked)}
          aria-label="Select row"
        />
      ),
    });
  }

  result.push(...columns);

  if (actions) {
    result.push({
      id: actionColumnId,
      header: actionColumnHeader,
      enableSorting: false,
      cell: ({ row }) => <RowActions row={row.original} items={actions(row.original)} baseHref={baseHref} />,
    });
  }

  // Attached rather than returned separately so every call site keeps passing a
  // plain `columns={...}` — see `ColumnsWithRowClick`.
  const withRowClick = result as ColumnsWithRowClick<T>;
  withRowClick.onRowClick = onRowClick;
  return withRowClick;
}

export const TextCell = ({ value, className }: { value?: string | null; className?: string }) =>
  value?.trim() ? (
    <div className={className}>{value}</div>
  ) : (
    <div className={cn("text-muted-foreground", className)}>—</div>
  );

export const DateCell = ({ date, className }: { date: Date | string | null; className?: string }) => {
  if (!date) return <div className={cn("text-muted-foreground", className)}>—</div>;
  return <div className={className}>{format(new Date(date), "dd/MM/yyyy")}</div>;
};

export const TimeCell = ({ date, className }: { date: Date | string | null; className?: string }) => {
  if (!date) return <div className={cn("text-muted-foreground", className)}>—</div>;
  return <div className={className}>{format(new Date(date), "HH:mm")}</div>;
};

export const DateTimeCell = ({ date, className }: { date: Date | string | null; className?: string }) => {
  if (!date) return <div className={cn("text-muted-foreground", className)}>—</div>;
  return <div className={className}>{format(new Date(date), "dd/MM/yyyy, HH:mm")}</div>;
};

export const RelativeTimeCell = ({ date, className }: { date: Date | string | null; className?: string }) => {
  if (!date) return <div className={cn("text-muted-foreground", className)}>—</div>;
  return (
    <div title={format(new Date(date), "dd/MM/yyyy HH:mm")} className={className}>
      {formatDistanceToNow(new Date(date), { addSuffix: true })}
    </div>
  );
};

export const CurrencyCell = ({
  amount,
  currency = "USD",
  display = "compact",
}: {
  amount: number;
  currency?: string;
  display?: "compact" | "full";
}) => {
  return <span>{formatCurrency(amount, currency, display)}</span>;
};

export const NumberCell = ({ value }: { value: number }) => {
  return <span>{new Intl.NumberFormat().format(value)}</span>;
};

export const PercentageCell = ({ value, decimals = 1 }: { value: number; decimals?: number }) => {
  return <span>{value.toFixed(decimals)}%</span>;
};

export const BooleanCell = ({ value, labels = ["Yes", "No"] }: { value: boolean; labels?: [string, string] }) => {
  return (
    <span className={cn("text-xs font-medium", value ? "text-success" : "text-destructive")}>
      {value ? labels[0] : labels[1]}
    </span>
  );
};

// ── Status cell ──────────────────────────────────────────────────────────────

export type StatusVariant = "amber" | "danger" | "draft" | "info" | "neutral" | "outline" | "success" | "warning";

const STATUS_DEFAULTS: Record<string, StatusVariant> = {
  active: "success",
  approved: "success",
  completed: "success",
  paid: "success",
  published: "success",
  cancelled: "danger",
  failed: "danger",
  rejected: "danger",
  terminated: "danger",
  draft: "draft",
  "in-progress": "warning",
  inactive: "neutral",
  pending: "warning",
  review: "info",
  suspended: "neutral",
};

export const STATUS_STYLES: Record<StatusVariant, string> = {
  amber: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  draft: "bg-muted text-muted-foreground border-border",
  info: "bg-primary/10 text-primary border-primary/30",
  neutral: "bg-muted text-muted-foreground border-border",
  outline: "bg-transparent text-foreground border-foreground",
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning border-warning/30",
};

interface StatusCellProps<TStatus extends string> {
  status: TStatus;
  /** Override or extend the default variant mapping. Keys autocomplete to the TStatus union. */
  className?: string;
  config?: Partial<Record<TStatus, StatusVariant>>;
  /** Variant used when the status matches no entry in the mapping. */
  default?: StatusVariant;
}

/** Splits kebab-case ("in-progress") and PascalCase ("PendingFinalApproval") status strings into readable words. */
const toReadableStatus = (status: string): string =>
  status
    .replace(/-/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();

export const StatusCell = <TStatus extends string>({
  status,
  className,
  config,
  default: fallback = "neutral",
}: StatusCellProps<TStatus>) => {
  const map: Record<string, StatusVariant> = config ? { ...STATUS_DEFAULTS, ...config } : STATUS_DEFAULTS;
  const variant = map[status?.toLowerCase()] ?? fallback;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
        STATUS_STYLES[variant],
        className,
      )}
    >
      {status ? toReadableStatus(status) : status}
    </span>
  );
};

export const SerialNumberCell = <T extends RowData>({ row }: { row: Row<DataTableFeatures, T> }) => (
  <span>{row.index + 1}</span>
);

/** Inline select cell for editing an enum-valued field (e.g. a role) directly in the row. */
export const SelectCell = <V extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: V;
  options: readonly V[];
  onChange: (value: V) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) => (
  <SelectOption
    size="sm"
    className="w-32 capitalize"
    aria-label={ariaLabel}
    value={value}
    disabled={disabled}
    onValueChange={(next) => onChange(next as V)}
    options={options.map((option) => ({ label: option, value: option }))}
  />
);
