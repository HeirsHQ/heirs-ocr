/**
 * Deterministic name handling for identity documents.
 *
 * The model returns the holder's name as labelled parts — surname, first name, middle
 * name — never as one string, because "one string" left it free to pick the word order,
 * and it picked differently run to run on the same file ("OBI ADA CHIOMA" once,
 * "ADA CHIOMA OBI" the next). `fullName` is then composed here in one fixed order.
 */
export type NameParts = { surname: string | null; firstName: string | null; middleName: string | null };

/** Uppercase with collapsed whitespace — how IDs and MRZs print names, so every run reads alike. */
export const normalizeNamePart = (value: string | null | undefined): string | null => {
  if (value == null) return null;
  const cleaned = value.toUpperCase().replace(/[<,]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || null;
};

/**
 * Normalizes each part. A first name carrying several given names ("ANNA MARIA", from a
 * "Given Names" label) keeps the first and moves the rest to the middle name, so the
 * split does not depend on how the document labelled them.
 */
export const normalizeNameParts = (parts: NameParts): NameParts => {
  const surname = normalizeNamePart(parts.surname);
  const given = normalizeNamePart(parts.firstName)?.split(" ") ?? [];
  const middle = normalizeNamePart(parts.middleName);
  const [firstName = null, ...rest] = given;
  return {
    surname,
    firstName,
    middleName: normalizeNamePart([...rest, middle].filter(Boolean).join(" ")),
  };
};

/** `FIRST MIDDLE SURNAME` — one fixed order regardless of how the document or the model ordered them. */
export const composeFullName = (parts: NameParts): string | null =>
  [parts.firstName, parts.middleName, parts.surname].filter(Boolean).join(" ") || null;

/** Comparable name tokens: diacritics, case, apostrophes and punctuation dropped. */
const nameTokens = (value: string): string[] =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/['’`]/g, "")
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .sort();

/**
 * Same names in any order: "Obi, Ada Chioma" matches "ADA CHIOMA OBI". Every name must
 * appear on both sides — a missing or extra middle name is still a mismatch, since
 * accepting a subset would let "ADA OBI" match a different "ADA NGOZI OBI".
 */
export const namesMatch = (actual: string | null, expected: string): boolean => {
  if (actual == null) return false;
  const a = nameTokens(actual);
  const b = nameTokens(expected);
  return a.length > 0 && a.length === b.length && a.every((token, i) => token === b[i]);
};
