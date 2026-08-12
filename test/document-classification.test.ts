import { describe, expect, it } from "vitest";

import { PNG_1x1, deps, fakeProvider, mockLlm, request, runPipeline } from "./support";
import { documentClassification } from "../src/functions/document-classification";
import type { DocumentClassificationResult } from "../src/functions/document-classification";

const classification = (label: string, confidence: number) => ({
  label,
  confidence,
  alternatives: [],
  rationale: "test",
});

describe("DOCUMENT_CLASSIFICATION — label with confidence", () => {
  it("classifies from the extracted markdown", async () => {
    const llm = mockLlm([["DOCUMENT_CLASSIFICATION_result", classification("invoice", 0.92)]]);
    const { result, meta } = await runPipeline(
      documentClassification,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("INVOICE\nTotal: 100")] }),
    );
    const data = result as DocumentClassificationResult;
    expect(data.label).toBe("invoice");
    expect(data.confidence).toBeCloseTo(0.92);
    // The pipeline surfaces the function's confidence into response meta.
    expect(meta.confidence).toBeCloseTo(0.92);
  });

  it("collapses a below-threshold label to 'unknown' when the caller allows it", async () => {
    // defaults: minConfidence 0.5, allowUnknown true.
    const llm = mockLlm([["DOCUMENT_CLASSIFICATION_result", classification("invoice", 0.2)]]);
    const { result } = await runPipeline(
      documentClassification,
      request(PNG_1x1, {}, "x.png"),
      deps({ llm, providers: [fakeProvider("ambiguous")] }),
    );
    expect((result as DocumentClassificationResult).label).toBe("unknown");
  });
});
