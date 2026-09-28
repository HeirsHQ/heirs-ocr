import { describe, expect, it, vi } from "vitest";
// The pipeline records usage counters and a document-registry row as it runs. Stub
// the pool so those writes cannot open a real connection whose failure resolves
// *after* the test ends — that surfaces as a flaky "Closing rpc while
// onUserConsoleLog was pending" teardown error rather than a test failure.
vi.mock("../src/db", () => ({
  query: async () => ({ rows: [], rowCount: 0 }),
  ensureSchema: async () => {},
  whenDbReady: async () => {},
  closeDb: async () => {},
}));

import { PNG_1x1, deps, fakeProvider, mockLlm, request, runPipeline } from "./support";
import { idVerification } from "../src/functions/id-verification";
import type { IdVerificationResult } from "../src/functions/id-verification";

type ExtractedFields = Omit<IdVerificationResult["fields"], "fullName">;

/** A fully-populated extraction fields object (all keys present, mostly null). */
const fields = (over: Partial<ExtractedFields> = {}): ExtractedFields => ({
  surname: null,
  firstName: null,
  middleName: null,
  dateOfBirth: null,
  documentNumber: null,
  issueDate: null,
  expiryDate: null,
  nationality: null,
  sex: null,
  placeOfBirth: null,
  address: null,
  licenceCategory: null,
  issuingAuthority: null,
  ...over,
});

const run = async (extracted: ExtractedFields, args: unknown = {}, markdown = "NIN SLIP") => {
  const llm = mockLlm([["ID_VERIFICATION_extraction", { documentType: "NIN", fields: extracted }]]);
  const { result } = await runPipeline(
    idVerification,
    request(PNG_1x1, args, "x.png"),
    deps({ llm, providers: [fakeProvider(markdown)] }),
  );
  return result as IdVerificationResult;
};

// Markdown carries no MRZ unless a test adds one, so `checks.mrzValid` is null.
describe("ID_VERIFICATION — extract fields + deterministic checks", () => {
  it("returns fields and honest assurance level, with no MRZ present", async () => {
    const data = await run(fields({ surname: "Obi", firstName: "Ada", documentNumber: "12345678901" }));
    expect(data.documentType).toBe("NIN");
    expect(data.fields.fullName).toBe("ADA OBI");
    expect(data.assuranceLevel).toBe("document-content-only");
    expect(data.checks.mrzValid).toBeNull();
  });

  it("computes expiry and expected-value checks deterministically", async () => {
    const data = await run(fields({ surname: "Obi", firstName: "Ada", expiryDate: "2000-01-01" }), {
      expected: { fullName: "Ada Obi" },
    });
    expect(data.checks.expired).toBe(true); // 2000-01-01 is in the past
    expect(data.checks.nameMatch).toBe(true);
  });

  describe("names read the same on every run", () => {
    it("composes one fixed order however the parts were cased or split", async () => {
      // Two runs over the same file that labelled the given names differently.
      const labelled = await run(fields({ surname: "OBI", firstName: "Ada", middleName: "Chioma" }));
      const givenNames = await run(fields({ surname: "obi", firstName: "ADA  CHIOMA", middleName: null }));
      for (const data of [labelled, givenNames]) {
        expect(data.fields).toMatchObject({
          fullName: "ADA CHIOMA OBI",
          surname: "OBI",
          firstName: "ADA",
          middleName: "CHIOMA",
        });
      }
    });

    it("matches the expected name in any order, case or punctuation", async () => {
      const extracted = fields({ surname: "Obi", firstName: "Ada", middleName: "Chioma" });
      for (const fullName of ["Obi Ada Chioma", "OBI, ADA CHIOMA", "chioma ada obi", "Ada Chioma Obi"]) {
        expect((await run(extracted, { expected: { fullName } })).checks.nameMatch, fullName).toBe(true);
      }
    });

    it("still rejects a different person, or a missing middle name", async () => {
      const extracted = fields({ surname: "Obi", firstName: "Ada", middleName: "Chioma" });
      expect((await run(extracted, { expected: { fullName: "Ada Ngozi Obi" } })).checks.nameMatch).toBe(false);
      expect((await run(extracted, { expected: { fullName: "Ada Obi" } })).checks.nameMatch).toBe(false);
    });
  });

  describe("dates are ISO whatever the print format", () => {
    it("normalizes date of birth, issue and expiry dates", async () => {
      const data = await run(fields({ dateOfBirth: "03/04/1990", issueDate: "10 MAY 2021", expiryDate: "09.05.2031" }));
      expect(data.fields).toMatchObject({
        dateOfBirth: "1990-04-03",
        issueDate: "2021-05-10",
        expiryDate: "2031-05-09",
      });
      expect(data.checks).toMatchObject({ expiryDate: "2031-05-09", expired: false });
    });

    it("matches date of birth across formats on both sides", async () => {
      const extracted = fields({ dateOfBirth: "03 APR 1990" });
      for (const dateOfBirth of ["1990-04-03", "03/04/1990", "3-4-90", "April 3, 1990", "19900403"]) {
        expect((await run(extracted, { expected: { dateOfBirth } })).checks.dobMatch, dateOfBirth).toBe(true);
      }
      expect((await run(extracted, { expected: { dateOfBirth: "1990-03-04" } })).checks.dobMatch).toBe(false);
    });

    it("keeps an unreadable date as printed and reports no match rather than guessing", async () => {
      const data = await run(fields({ dateOfBirth: "unclear" }), { expected: { dateOfBirth: "1990-04-03" } });
      expect(data.fields.dateOfBirth).toBe("unclear");
      expect(data.checks.dobMatch).toBe(false);
    });
  });

  it("takes the name split and dates from a valid MRZ", async () => {
    const mrz = ["P<NGAERIKSSON<<ANNA<MARIA".padEnd(44, "<"), "L898902C36NGA7408122F1204159ZE184226B<<<<<10"];
    const data = await run(
      // The model got the order wrong; the MRZ's structural split wins.
      fields({ surname: "ANNA", firstName: "ERIKSSON", dateOfBirth: "12/08/1974" }),
      { expected: { fullName: "Eriksson Anna Maria", dateOfBirth: "12 AUG 1974" } },
      `PASSPORT\n${mrz.join("\n")}`,
    );
    expect(data.checks.mrzValid).toBe(true);
    expect(data.fields).toMatchObject({
      fullName: "ANNA MARIA ERIKSSON",
      surname: "ERIKSSON",
      firstName: "ANNA",
      middleName: "MARIA",
      dateOfBirth: "1974-08-12",
      expiryDate: "2012-04-15",
    });
    expect(data.checks).toMatchObject({ nameMatch: true, dobMatch: true, expired: true });
  });
});
