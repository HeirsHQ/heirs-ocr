import type { Request } from "express";

/**
 * The list envelope every collection endpoint returns.
 *
 * One shape for all of them so a client can page any list without knowing which
 * one it is holding — the console's table component takes exactly these fields.
 * `totalPages` is derived, not stored: it is returned anyway so the caller never
 * has to re-derive it (and never disagrees with the server about the divide).
 */
export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

export type PageParams = { page: number; pageSize: number };

/** Parses a positive integer query param, falling back for missing/NaN/≤0 input. */
const positiveInt = (raw: unknown, fallback: number): number => {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
};

/**
 * Reads `?page=&pageSize=` off a request. Both are advisory: garbage falls back to
 * the defaults rather than 400-ing, because a bad page number is not a reason to
 * refuse to render a list. `pageSize` is capped — an unbounded one lets any caller
 * turn a paginated endpoint back into a full table scan.
 */
export const pageParams = (query: Request["query"]): PageParams => ({
  page: positiveInt(query.page, 1),
  pageSize: Math.min(positiveInt(query.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE),
});

/**
 * Wraps an already-materialised list in {@link Paginated}, slicing it in memory.
 *
 * Correct for the bounded collections it is used on (plans, tenants, admins,
 * backups, the capped log ring buffer): the underlying stores read a whole small
 * table anyway, so slicing here costs nothing and keeps one pagination contract.
 * It is *not* a substitute for a `LIMIT`/`OFFSET` when a table grows without bound
 * — `audit_events` pages in SQL for that reason (see `listAuditEventsPage`).
 *
 * The requested page is clamped to the last non-empty one, so deleting the only row
 * on page 3 leaves the caller looking at page 2 rather than a blank table.
 */
export const paginate = <T>(items: T[], { page, pageSize }: PageParams): Paginated<T> => {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: current, pageSize, total, totalPages };
};

/**
 * Builds the envelope around a page the *store* has already sliced (SQL
 * `LIMIT`/`OFFSET` plus a `COUNT(*)`), where re-slicing here would drop rows.
 */
export const paginatedFrom = <T>(items: T[], total: number, { page, pageSize }: PageParams): Paginated<T> => ({
  items,
  page,
  pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
});
