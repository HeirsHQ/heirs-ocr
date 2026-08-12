import { describe, expect, it } from "vitest";

import { PNG_1x1, deps, fakeProvider, request, runPipeline } from "./support";
import { signing } from "../src/functions/signing";
import type { SigningResult } from "../src/functions/signing";
import type { LayoutBlock } from "../src/providers/types";

// A signature cue block sitting just above a correlated image block (an empty
// signature slot). `geometryOnly` reports the located slots and skips the vision
// judgment, so this stays deterministic and needs no LLM/rasterization.
const blocks: LayoutBlock[] = [
  { index: 0, page: 1, label: "text", bbox: [0.1, 0.8, 0.4, 0.85], content: "Signature:" },
  { index: 1, page: 1, label: "image", bbox: [0.1, 0.86, 0.4, 0.95], content: "" },
];

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
  });
});
