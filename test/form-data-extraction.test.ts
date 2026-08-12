import { describe, expect, it } from "vitest";

import { PNG_1x1, deps, fakeProvider, mockLlm, request, runPipeline } from "./support";
import { formDataExtraction } from "../src/functions/form-data-extraction";
import type { FormDataExtractionResult } from "../src/functions/form-data-extraction";

describe("FORM_DATA_EXTRACTION — caller-defined fields", () => {
  it("extracts the fields named in a structured spec", async () => {
    const llm = mockLlm([["FORM_DATA_EXTRACTION_result", { fields: { invoiceNo: "INV-1", amount: 1000 } }]]);
    const args = {
      fields: [
        { name: "invoiceNo", type: "string", required: true },
        { name: "amount", type: "number" },
      ],
    };
    const { result } = await runPipeline(
      formDataExtraction,
      request(PNG_1x1, args, "x.png"),
      deps({ llm, providers: [fakeProvider("INVOICE INV-1 total 1000")] }),
    );
    const fields = (result as FormDataExtractionResult).fields;
    expect(fields.invoiceNo).toBe("INV-1");
    expect(fields.amount).toBe(1000);
  });

  it("rejects extracted fields that violate a caller-supplied JSON Schema", async () => {
    // Schema requires `name`, but the model omits it → ajv rejects post-hoc.
    // (Kept shallow: the args guard caps jsonSchema nesting at depth 3.)
    const llm = mockLlm([["FORM_DATA_EXTRACTION_result", { fields: {} }]]);
    const args = { jsonSchema: { type: "object", required: ["name"] } };
    await expect(
      runPipeline(formDataExtraction, request(PNG_1x1, args, "x.png"), deps({ llm, providers: [fakeProvider("doc")] })),
    ).rejects.toMatchObject({ code: "SCHEMA_VALIDATION_FAILED" });
  });
});
