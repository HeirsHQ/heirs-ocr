import { describe, expect, it } from "vitest";

import { PNG_1x1, deps, fakeProvider, mockLlm, request, runPipeline } from "./support";
import { idVerification } from "../src/functions/id-verification";
import type { IdVerificationResult } from "../src/functions/id-verification";

/** A fully-populated fields object (all keys present, mostly null) for the extraction fixture. */
const fields = (over: Partial<IdVerificationResult["fields"]> = {}): IdVerificationResult["fields"] => ({
  fullName: null,
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

// Markdown carries no MRZ, so `checks.mrzValid` is null and the LLM fields pass through.
describe("ID_VERIFICATION — extract fields + deterministic checks", () => {
  it("returns fields and honest assurance level, with no MRZ present", async () => {
    const llm = mockLlm([
      [
        "ID_VERIFICATION_extraction",
        { documentType: "NIN", fields: fields({ fullName: "Ada Obi", documentNumber: "12345678901" }) },
      ],
    ]);
    const { result } = await runPipeline(
      idVerification,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("NIN\nAda Obi\n12345678901")] }),
    );
    const data = result as IdVerificationResult;
    expect(data.documentType).toBe("NIN");
    expect(data.fields.fullName).toBe("Ada Obi");
    expect(data.assuranceLevel).toBe("document-content-only");
    expect(data.checks.mrzValid).toBeNull();
  });

  it("computes expiry and expected-value checks deterministically", async () => {
    const llm = mockLlm([
      [
        "ID_VERIFICATION_extraction",
        { documentType: "PASSPORT", fields: fields({ fullName: "Ada Obi", expiryDate: "2000-01-01" }) },
      ],
    ]);
    const { result } = await runPipeline(
      idVerification,
      request(PNG_1x1, { expected: { fullName: "Ada Obi" } }, "x.png"),
      deps({ llm, providers: [fakeProvider("PASSPORT\nAda Obi")] }),
    );
    const { checks } = result as IdVerificationResult;
    expect(checks.expired).toBe(true); // 2000-01-01 is in the past
    expect(checks.nameMatch).toBe(true); // matches the expected full name
  });
});
