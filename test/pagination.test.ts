import { describe, expect, it } from "vitest";
import type { Request } from "express";

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageParams, paginate, paginatedFrom } from "../src/http/pagination";

/** `req.query` as Express hands it over — every value is a string or absent. */
const query = (q: Record<string, string | string[]>) => q as unknown as Request["query"];

const rows = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe("pageParams", () => {
  it("defaults to the first page at the default size", () => {
    expect(pageParams(query({}))).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it("reads page and pageSize off the query string", () => {
    expect(pageParams(query({ page: "3", pageSize: "50" }))).toEqual({ page: 3, pageSize: 50 });
  });

  it("falls back rather than rejecting nonsense, so a bad page still renders a list", () => {
    for (const bad of ["0", "-2", "abc", "", "1e999"]) {
      expect(pageParams(query({ page: bad }))).toMatchObject({ page: 1 });
    }
    expect(pageParams(query({ pageSize: "abc" }))).toMatchObject({ pageSize: DEFAULT_PAGE_SIZE });
  });

  it("caps pageSize so a caller cannot turn a paged endpoint into a full scan", () => {
    expect(pageParams(query({ pageSize: "100000" }))).toMatchObject({ pageSize: MAX_PAGE_SIZE });
  });

  it("takes the first value when a param is repeated", () => {
    expect(pageParams(query({ page: ["2", "9"] }))).toMatchObject({ page: 2 });
  });
});

describe("paginate", () => {
  it("slices the requested window and reports the totals", () => {
    const page = paginate(rows(25), { page: 2, pageSize: 10 });
    expect(page).toMatchObject({ page: 2, pageSize: 10, total: 25, totalPages: 3 });
    expect(page.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("returns a short final page rather than padding it", () => {
    expect(paginate(rows(25), { page: 3, pageSize: 10 }).items).toEqual([21, 22, 23, 24, 25]);
  });

  it("clamps past-the-end pages back to the last one", () => {
    // Deleting the only row on page 3 should leave the caller looking at page 2,
    // not at a blank table with no way back.
    const page = paginate(rows(11), { page: 9, pageSize: 10 });
    expect(page).toMatchObject({ page: 2, total: 11, totalPages: 2 });
    expect(page.items).toEqual([11]);
  });

  it("reports one empty page for an empty collection", () => {
    expect(paginate([], { page: 1, pageSize: 10 })).toEqual({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 1,
    });
  });
});

describe("paginatedFrom", () => {
  it("wraps a store-sliced page without re-slicing it", () => {
    // The rows are already page 3; slicing again here would drop them all.
    expect(paginatedFrom([21, 22], 42, { page: 3, pageSize: 10 })).toEqual({
      items: [21, 22],
      page: 3,
      pageSize: 10,
      total: 42,
      totalPages: 5,
    });
  });
});
