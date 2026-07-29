import type { LayoutBlock, PageResult, RecognizedDocument } from "../types";
import type { LayoutParsingResponse } from "./client";

/**
 * Maps one or more {@link LayoutParsingResponse} chunks into the canonical
 * {@link RecognizedDocument}. GLM's `bbox_2d` is already normalized 0–1, so it
 * carries straight into {@link LayoutBlock.bbox}. `label` maps 1:1.
 *
 * @param responses - Per-chunk responses in page order (chunker output).
 * @param meta - Provider name + timing to stamp onto the result.
 */
export const mapLayoutParsing = (
  _responses: LayoutParsingResponse[],
  _meta: { provider: string; durationMs: number; fellBackFrom?: string },
): RecognizedDocument => {
  // TODO: flatten layout_details[page][block] → LayoutBlock[] (offset page indices
  // across chunks), concat md_results → markdown, derive plainText + PageResult[].
  throw new Error("mapLayoutParsing: not implemented");
};

/** Flattens a single response's per-page details into a page-numbered block list. */
export const toBlocks = (_response: LayoutParsingResponse, _pageOffset: number): LayoutBlock[] => {
  throw new Error("toBlocks: not implemented");
};

/** Derives per-page markdown results from a response. */
export const toPages = (_response: LayoutParsingResponse, _pageOffset: number): PageResult[] => {
  throw new Error("toPages: not implemented");
};
