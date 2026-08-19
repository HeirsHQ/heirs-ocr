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

import { PNG_1x1, deps, request, runPipeline } from "./support";
import { documentAuthenticity } from "../src/functions/document-authenticity";
import type { DocumentAuthenticityResult } from "../src/functions/document-authenticity";

const VERDICTS = ["clean", "suspicious", "likely-doctored", "inconclusive"];

// DOCUMENT_AUTHENTICITY has `skipExtraction`: no provider/OCR runs, the analyzer
// works on the raw uploaded bytes.
describe("DOCUMENT_AUTHENTICITY — deterministic tamper analysis, no LLM", () => {
  it("analyzes raw image bytes and returns a heuristic verdict", async () => {
    const { result } = await runPipeline(documentAuthenticity, request(PNG_1x1, {}, "x.png"), deps({ providers: [] }));
    const data = result as DocumentAuthenticityResult;
    expect(data.analyzer).toBe("image");
    expect(data.assuranceLevel).toBe("heuristic-only");
    expect(VERDICTS).toContain(data.verdict);
    expect(data.score).toBeGreaterThanOrEqual(0);
    expect(data.score).toBeLessThanOrEqual(1);
  });
});
