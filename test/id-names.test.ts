import { describe, expect, it } from "vitest";

import { composeFullName, namesMatch, normalizeNameParts } from "../src/functions/id-verification/names";

describe("ID name handling", () => {
  it("splits several given names into first + middle and composes one order", () => {
    const parts = normalizeNameParts({ surname: " obi ", firstName: "Ada  Chioma", middleName: "Ngozi" });
    expect(parts).toEqual({ surname: "OBI", firstName: "ADA", middleName: "CHIOMA NGOZI" });
    expect(composeFullName(parts)).toBe("ADA CHIOMA NGOZI OBI");
    expect(composeFullName({ surname: null, firstName: null, middleName: null })).toBeNull();
  });

  it("matches regardless of order, case, commas, hyphens, apostrophes and accents", () => {
    expect(namesMatch("ADA CHIOMA OBI", "Obi, Ada Chioma")).toBe(true);
    expect(namesMatch("ADEBAYO-OGUN TOLU", "Tolu Adebayo Ogun")).toBe(true);
    expect(namesMatch("SEAN O'NEIL", "O NEIL SEAN")).toBe(false); // "O" is its own token here
    expect(namesMatch("SEAN O'NEIL", "Oneil Sean")).toBe(true);
    expect(namesMatch("JOSÉ ÉMILE", "Emile Jose")).toBe(true);
  });

  it("requires every name on both sides", () => {
    expect(namesMatch("ADA CHIOMA OBI", "Ada Obi")).toBe(false);
    expect(namesMatch("ADA OBI", "Ada Ngozi Obi")).toBe(false);
    expect(namesMatch(null, "Ada Obi")).toBe(false);
    expect(namesMatch("", "")).toBe(false);
  });
});
