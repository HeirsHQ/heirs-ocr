import type { Capability, DocumentInput, MimeGroup, OcrProvider, RecognizedDocument, RecognizeOptions } from "../types";
import { GlmClient } from "./client";

/**
 * GLM-OCR extraction provider — the layout-aware, seal-capable path. Its
 * standout capability is seal/stamp recognition, which is why
 * SIGNING and stamped Nigerian documents route here. Extraction only; Azure
 * OpenAI stays the interpretation layer.
 */
export class GlmOcrProvider implements OcrProvider {
  readonly name = "glm-ocr";
  readonly accepts: readonly MimeGroup[] = ["pdf", "image"];
  readonly capabilities: readonly Capability[] = ["text", "layout", "tables", "handwriting", "seals"];

  constructor(private readonly client: GlmClient) {}

  async recognize(_input: DocumentInput, _opts: RecognizeOptions): Promise<RecognizedDocument> {
    void this.client; // used once chunker + client.layoutParsing are wired
    // TODO: chunk (splitPdfToPageImages) → mapWithConcurrency(client.layoutParsing) → mapLayoutParsing.
    throw new Error("GlmOcrProvider.recognize: not implemented");
  }
}

export { GlmClient } from "./client";
export type { LayoutParsingRequest, LayoutParsingResponse, LayoutDetail } from "./client";
