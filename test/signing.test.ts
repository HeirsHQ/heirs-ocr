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

import { PNG_1x1, deps, fakeProvider, makeDoc, mockLlm, request, runPipeline } from "./support";
import { signing } from "../src/functions/signing";
import type { SigningResult } from "../src/functions/signing";
import type { DocumentInput, LayoutBlock, OcrProvider, RecognizeOptions } from "../src/providers/types";

// A signature cue block sitting just above a correlated image block (an empty
// signature slot). `geometryOnly` reports the located slots and skips the vision
// judgment, so this stays deterministic and needs no LLM/rasterization.
const blocks: LayoutBlock[] = [
  { index: 0, page: 1, label: "text", bbox: [0.1, 0.8, 0.4, 0.85], content: "Signature:" },
  { index: 1, page: 1, label: "image", bbox: [0.1, 0.86, 0.4, 0.95], content: "" },
];

/**
 * A provider shaped like Tesseract: `layout` but no `seals`, and — the part that
 * matters — every block labelled `text`, never `image`. This is what the registry
 * falls back to when GLM is disabled, and what the whole-page path exists for.
 */
const noSealProvider = (markdown: string, over = {}): OcrProvider => ({
  name: "tesseract",
  accepts: ["image", "pdf"],
  capabilities: ["text", "layout"],
  recognize: async (_i: DocumentInput, _o: RecognizeOptions) => makeDoc(markdown, { provider: "tesseract", ...over }),
});

/** Tesseract emits one block per word, all `label: "text"`. */
const wordBlocks = (words: string[]): LayoutBlock[] =>
  words.map((w, i) => ({
    index: i,
    page: 1,
    label: "text" as const,
    bbox: [0.1 + i * 0.02, 0.8, 0.15 + i * 0.02, 0.83] as [number, number, number, number],
    content: w,
  }));

describe("SIGNING — geometry-only slot detection", () => {
  it("locates a signature slot and reports it unsigned without a vision pass", async () => {
    const { result } = await runPipeline(
      signing,
      request(PNG_1x1, { geometryOnly: true }, "x.png"),
      deps({ providers: [fakeProvider("SIGN HERE", { blocks })] }),
    );
    const data = result as SigningResult;
    expect(data.blocks).toHaveLength(1);
    expect(data.fullyExecuted).toBe(false);
    expect(data.unsignedBlocks).toContain("Signature");
    // A seal-capable provider located the region: this is the precise path.
    expect(data.confidence).toBe("high");
    expect(data.warnings).toEqual([]);
  });
});

describe("SIGNING — whole-page fallback when the provider lacks `seals`", () => {
  it("judges a signed contract correctly where region detection would report it unsigned", async () => {
    const { result } = await runPipeline(
      signing,
      request(PNG_1x1, {}, "contract.png"),
      deps({
        providers: [
          noSealProvider("Signature: ......  Director  Witness", { blocks: wordBlocks(["Signature:", "Director"]) }),
        ],
        llm: mockLlm([
          [
            "SIGNING_whole_page",
            {
              blocks: [
                {
                  label: "Director",
                  signed: true,
                  hasSeal: true,
                  signatoryName: "A. Okafor",
                  signedDate: "2026-08-14",
                },
                { label: "Witness", signed: true, hasSeal: false, signatoryName: "B. Eze", signedDate: "2026-08-14" },
              ],
            },
          ],
        ]),
      }),
    );
    const data = result as SigningResult;
    // The regression this whole path exists to prevent: a fully executed contract
    // must not come back as entirely unsigned just because no `image` blocks exist.
    expect(data.fullyExecuted).toBe(true);
    expect(data.unsignedBlocks).toEqual([]);
    expect(data.blocks.map((b) => b.label)).toEqual(["Director", "Witness"]);
    expect(data.blocks[0]?.signatoryName).toBe("A. Okafor");
    // Degraded runs are always labelled, and carry no geometry.
    expect(data.confidence).toBe("low");
    expect(data.warnings.join(" ")).toMatch(/without `seals`/);
    expect(data.blocks.every((b) => b.bbox === undefined)).toBe(true);
  });

  it("still reports genuinely unsigned blocks as unsigned", async () => {
    const { result } = await runPipeline(
      signing,
      request(PNG_1x1, {}, "draft.png"),
      deps({
        providers: [noSealProvider("Signature: ____  Director")],
        llm: mockLlm([
          [
            "SIGNING_whole_page",
            { blocks: [{ label: "Director", signed: false, hasSeal: false, signatoryName: null, signedDate: null }] },
          ],
        ]),
      }),
    );
    const data = result as SigningResult;
    expect(data.fullyExecuted).toBe(false);
    expect(data.unsignedBlocks).toEqual(["Director"]);
    expect(data.confidence).toBe("low");
  });

  it("warns instead of guessing when the page carries no signature blocks", async () => {
    const { result } = await runPipeline(
      signing,
      request(PNG_1x1, {}, "memo.png"),
      deps({
        providers: [noSealProvider("An internal memo with no execution page.")],
        llm: mockLlm([["SIGNING_whole_page", { blocks: [] }]]),
      }),
    );
    const data = result as SigningResult;
    expect(data.blocks).toEqual([]);
    expect(data.fullyExecuted).toBe(false);
    expect(data.warnings.join(" ")).toMatch(/No signature blocks were identified/);
  });

  it("refuses a geometry-only probe rather than passing word boxes off as regions", async () => {
    const { result } = await runPipeline(
      signing,
      request(PNG_1x1, { geometryOnly: true }, "x.png"),
      deps({ providers: [noSealProvider("Signature:", { blocks: wordBlocks(["Signature:"]) })] }),
    );
    const data = result as SigningResult;
    expect(data.blocks).toEqual([]);
    expect(data.confidence).toBe("low");
    expect(data.warnings.join(" ")).toMatch(/geometryOnly` requires a `seals`-capable provider/);
  });
});
