/**
 * Deterministic date normalization for identity documents. The model copies dates as
 * printed ("12/08/1974", "12 AUG/AOÛT 74", "740812"); this turns every one into ISO
 * `YYYY-MM-DD` so the same document reads the same on every run and two dates compare
 * equal whatever format each side was written in.
 *
 * Asking the model to reformat instead is the trap: it resolves the DD/MM vs MM/DD
 * ambiguity differently run to run, and a swapped day and month is a plausible date
 * nobody notices.
 */

/**
 * How a two-digit year gets its century. Birth and issue dates lie in the past, so a
 * year that would land in the future belongs to the 1900s. Expiry dates run forward,
 * up to 50 years out.
 */
export type Century = "past" | "future";

/**
 * Month-name prefixes, English and the French printed beside it on bilingual passports
 * ("AUG/AOÛT"). Matched against the start of a letter token after diacritics are
 * stripped; the four-letter French forms come first so JUIN/JUIL are not misread.
 */
const MONTH_PREFIXES: ReadonlyArray<[string, number]> = [
  ["JUIN", 6],
  ["JUIL", 7],
  ["JAN", 1],
  ["FEB", 2],
  ["FEV", 2],
  ["MAR", 3],
  ["APR", 4],
  ["AVR", 4],
  ["MAY", 5],
  ["MAI", 5],
  ["JUN", 6],
  ["JUL", 7],
  ["AUG", 8],
  ["AOU", 8],
  ["SEP", 9],
  ["OCT", 10],
  ["NOV", 11],
  ["DEC", 12],
];

const monthFromName = (token: string): number | null => {
  if (token.length < 3) return null;
  return MONTH_PREFIXES.find(([prefix]) => token.startsWith(prefix))?.[1] ?? null;
};

const stripDiacritics = (value: string): string => value.normalize("NFD").replace(/\p{M}/gu, "");

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

const expandYear = (digits: string, century: Century, now: Date): number => {
  const n = Number(digits);
  if (digits.length !== 2) return n;
  const thisYear = now.getUTCFullYear();
  const candidate = 2000 + n;
  if (century === "past") return candidate > thisYear ? candidate - 100 : candidate;
  return candidate > thisYear + 50 ? candidate - 100 : candidate;
};

/** A real calendar date (rejects 31 April, 29 February outside leap years), as ISO. */
const toIso = (year: number, month: number, day: number): string | null => {
  if (!Number.isInteger(year) || year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
};

/**
 * Parses a date as printed on an identity document into ISO `YYYY-MM-DD`, or `null`
 * when it cannot be read unambiguously as a real date.
 *
 * - Year first (`1974-08-12`, `1974/08/12`, ISO datetimes): year, month, day.
 * - Numeric day and month (`12/08/1974`, `12.08.74`, `12-08-1974`): **day first**,
 *   the convention on Nigerian and ICAO documents. Month first is used only when day
 *   first is impossible (`08/25/1974`).
 * - Month names (`12 AUG 1974`, `August 12, 1974`, `12AUG74`, `12 AUG/AOUT 74`).
 * - Compact digits: `YYYYMMDD` or `DDMMYYYY` (8), and MRZ `YYMMDD` (6).
 */
export const parseIdDate = (value: string | null | undefined, century: Century, now = new Date()): string | null => {
  if (value == null) return null;
  const tokens =
    stripDiacritics(value)
      .toUpperCase()
      .match(/[A-Z]+|\d+/g) ?? [];
  const numbers = tokens.filter((t) => /^\d+$/.test(t));
  const month = tokens.map(monthFromName).find((m) => m !== null) ?? null;

  if (month !== null) {
    const [first, second] = numbers;
    if (first === undefined || second === undefined) return null;
    // Whichever number is four digits is the year; otherwise the day comes first
    // both in "12 AUG 74" and in "AUG 12 74".
    const [day, year] = first.length === 4 ? [second, first] : [first, second];
    return toIso(expandYear(year, century, now), month, Number(day));
  }

  if (numbers.length === 1) {
    const digits = numbers[0]!;
    if (digits.length === 8) {
      const yearFirst = /^(19|20)/.test(digits)
        ? toIso(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8)))
        : null;
      return yearFirst ?? toIso(Number(digits.slice(4, 8)), Number(digits.slice(2, 4)), Number(digits.slice(0, 2)));
    }
    if (digits.length === 6) {
      return toIso(
        expandYear(digits.slice(0, 2), century, now),
        Number(digits.slice(2, 4)),
        Number(digits.slice(4, 6)),
      );
    }
    return null;
  }

  // Trailing numbers (a time of day on a datetime) are ignored.
  const [a, b, c] = numbers;
  if (a === undefined || b === undefined || c === undefined) return null;
  if (a.length === 4) return toIso(Number(a), Number(b), Number(c));
  if (c.length !== 2 && c.length !== 4) return null;
  const year = expandYear(c, century, now);
  return toIso(year, Number(b), Number(a)) ?? toIso(year, Number(a), Number(b));
};

/** ISO when the printed date parses; otherwise the printed text, so an unreadable date is never silently dropped. */
export const normalizeIdDate = (value: string | null, century: Century, now = new Date()): string | null => {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return parseIdDate(trimmed, century, now) ?? trimmed;
};

/** Same calendar day, whatever format either side was written in. `false` when either side cannot be read. */
export const datesMatch = (actual: string | null, expected: string, century: Century = "past"): boolean => {
  const a = parseIdDate(actual, century);
  const b = parseIdDate(expected, century);
  return a !== null && a === b;
};

/** Expired once the expiry day has passed (a document is still valid on its expiry date). `null` when unreadable. */
export const isExpired = (expiryDate: string | null, now = new Date()): boolean | null => {
  const iso = parseIdDate(expiryDate, "future", now);
  if (iso === null) return null;
  const today = `${pad(now.getUTCFullYear(), 4)}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  return iso < today;
};
