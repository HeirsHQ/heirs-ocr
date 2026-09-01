import { describe, expect, it } from "vitest";

import { buildCatalog } from "../src/functions/registry";

/**
 * `GET /v1/ocr/functions` is a public contract — clients generate forms and
 * validate client-side from these JSON Schemas. Giving a function a dynamic
 * `resultSchema` used to drop its result shape from the catalog silently, which is
 * a breaking change for those clients rather than an internal detail.
 */
describe("function catalog", () => {
  const catalog = buildCatalog();
  const entry = (key: string) => catalog.find((e) => e.key === key)!;

  it("publishes a result schema for every function whose shape is knowable up front", () => {
    // FORM_DATA_EXTRACTION is the one genuine exception: its args are a required
    // union, so there is no result shape at all until a caller supplies one.
    const omitted = catalog.filter((e) => !e.resultSchema).map((e) => e.key);
    expect(omitted).toEqual(["FORM_DATA_EXTRACTION"]);
  });

  it("still publishes the canonical receipt shape now that its schema is dynamic", () => {
    const props = Object.keys((entry("RECEIPT_PARSING").resultSchema as { properties?: object })?.properties ?? {});
    expect(props).toContain("merchant");
    expect(props).toContain("lineItems");
    expect(props).toContain("confidence");
  });

  it("advertises fieldMap so callers can discover the renaming option", () => {
    const props = Object.keys((entry("RECEIPT_PARSING").argsSchema as { properties?: object })?.properties ?? {});
    expect(props).toContain("fieldMap");
    expect(props).toContain("lineItemMode");
  });

  it("reports the capability preferences a function declares", () => {
    expect(entry("RECEIPT_PARSING").prefers).toEqual(["tables"]);
    expect(entry("SIGNING").prefers).toEqual(["seals"]);
    expect(entry("TEXT_EXTRACTION").prefers).toBeUndefined();
  });
});
