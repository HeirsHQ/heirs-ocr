import { describe, expect, it } from "vitest";

import { datesMatch, isExpired, normalizeIdDate, parseIdDate } from "../src/functions/id-verification/dates";

const NOW = new Date(Date.UTC(2026, 8, 16));

describe("parseIdDate", () => {
  it.each([
    ["1990-04-03", "1990-04-03"],
    ["1990/04/03", "1990-04-03"],
    ["1990-04-03T00:00:00Z", "1990-04-03"],
    ["03/04/1990", "1990-04-03"], // day first: the document convention
    ["03.04.1990", "1990-04-03"],
    ["3-4-1990", "1990-04-03"],
    ["04/25/1990", "1990-04-25"], // month first only when day first is impossible
    ["03 APR 1990", "1990-04-03"],
    ["3 April 1990", "1990-04-03"],
    ["April 3, 1990", "1990-04-03"],
    ["03APR90", "1990-04-03"],
    ["12 AUG/AOÛT 74", "1974-08-12"], // bilingual passport print
    ["12 JUIL 1974", "1974-07-12"],
    ["19900403", "1990-04-03"],
    ["03041990", "1990-04-03"],
    ["900403", "1990-04-03"], // MRZ YYMMDD
  ])("reads %s", (printed, iso) => {
    expect(parseIdDate(printed, "past", NOW)).toBe(iso);
  });

  it("gives two-digit years the century their kind of date implies", () => {
    expect(parseIdDate("01/01/45", "past", NOW)).toBe("1945-01-01"); // a birth date cannot be in the future
    expect(parseIdDate("01/01/25", "past", NOW)).toBe("2025-01-01");
    expect(parseIdDate("01/01/45", "future", NOW)).toBe("2045-01-01"); // an expiry can
  });

  it.each(["31/04/1990", "29/02/1990", "13/13/1990", "unclear", "", "1990"])("rejects %s", (value) => {
    expect(parseIdDate(value, "past", NOW)).toBeNull();
  });
});

describe("date helpers", () => {
  it("keeps unreadable text rather than dropping it", () => {
    expect(normalizeIdDate(" 03/04/1990 ", "past", NOW)).toBe("1990-04-03");
    expect(normalizeIdDate("illegible", "past", NOW)).toBe("illegible");
    expect(normalizeIdDate("  ", "past", NOW)).toBeNull();
  });

  it("matches the same calendar day across formats only", () => {
    expect(datesMatch("03 APR 1990", "1990-04-03")).toBe(true);
    expect(datesMatch("03/04/1990", "1990-03-04")).toBe(false);
    expect(datesMatch(null, "1990-04-03")).toBe(false);
  });

  it("treats a document as valid through its expiry day", () => {
    expect(isExpired("16/09/2026", NOW)).toBe(false);
    expect(isExpired("15/09/2026", NOW)).toBe(true);
    expect(isExpired("unclear", NOW)).toBeNull();
  });
});
