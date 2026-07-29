/**
 * Splits multi-page PDFs into page-level image calls run with bounded
 * concurrency. GLM's throughput profile rewards page-parallel
 * base64 image calls over serial file upload, and this also sidesteps the PDF
 * page cap.
 */
export type PageChunk = {
  /** 1-based page number this chunk covers. */
  page: number;
  /** base64 data URI of the rasterized page (`data:image/png;base64,...`). */
  dataUri: string;
};

/** Rasterizes each PDF page to a PNG data URI via pdf-lib / pdf-to-img. */
export const splitPdfToPageImages = async (_buffer: Buffer): Promise<PageChunk[]> => {
  // TODO: render each page to PNG, encode as base64 data URI.
  throw new Error("splitPdfToPageImages: not implemented");
};

/**
 * Runs `task` over `items` with at most `limit` in flight, preserving order.
 * Backed by `p-limit`.
 */
export const mapWithConcurrency = async <T, R>(
  _items: readonly T[],
  _limit: number,
  _task: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  throw new Error("mapWithConcurrency: not implemented");
};
