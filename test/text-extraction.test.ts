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

import { deps, request, runPipeline } from "./support";
import { textExtraction } from "../src/functions/text-extraction";
import type { TextExtractionResult } from "../src/functions/text-extraction";

// TEXT_EXTRACTION is the no-LLM path: the canonical document is returned more or
// less directly, honoring `format` and `includeBlocks`.
describe("TEXT_EXTRACTION — canonical extraction, no LLM", () => {
  it("returns markdown text end to end via the plain-text provider", async () => {
    const { result, meta } = await runPipeline(
      textExtraction,
      request(Buffer.from("Hello world"), {}, "doc.txt"),
      deps(),
    );
    const data = result as TextExtractionResult;
    expect(data.text).toBe("Hello world");
    expect(data.format).toBe("markdown");
    expect(data.pageCount).toBe(1);
    expect(meta.provider).toBe("plain-text");
    expect(meta.cached).toBe(false);
  });

  it("honors format: 'plain'", async () => {
    const { result } = await runPipeline(
      textExtraction,
      request(Buffer.from("Hello world"), { format: "plain" }, "doc.txt"),
      deps(),
    );
    expect((result as TextExtractionResult).format).toBe("plain");
    expect((result as TextExtractionResult).text).toBe("Hello world");
  });

  it("includes layout blocks only when asked", async () => {
    const withoutBlocks = await runPipeline(textExtraction, request(Buffer.from("hi"), {}, "doc.txt"), deps());
    expect((withoutBlocks.result as TextExtractionResult).blocks).toBeUndefined();

    const withBlocks = await runPipeline(
      textExtraction,
      request(Buffer.from("hi"), { includeBlocks: true }, "doc.txt"),
      deps(),
    );
    expect(Array.isArray((withBlocks.result as TextExtractionResult).blocks)).toBe(true);
  });
});
