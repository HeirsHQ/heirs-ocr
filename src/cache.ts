import type { RecognizedDocument } from "./providers/types";

/**
 * Extraction-layer cache. Cache extraction, never interpretation:
 * the same PDF hitting DOCUMENT_CLASSIFICATION then RECEIPT_PARSING pays for
 * GLM-OCR once. Skip entirely for `sensitivity: "pii"`.
 *
 * Key: `ocr:extract:{sha256}:{provider}:{pageRange}`. Redis, TTL ~7 days.
 */
export const extractionCacheKey = (sha256: string, provider: string, pageRange?: [number, number]): string =>
  `ocr:extract:${sha256}:${provider}:${pageRange ? `${pageRange[0]}-${pageRange[1]}` : "all"}`;

export interface ExtractionCache {
  get(key: string): Promise<RecognizedDocument | undefined>;
  set(key: string, doc: RecognizedDocument, ttlSeconds: number): Promise<void>;
}

/** No-op cache used until Redis is wired. Always misses. */
export const noopCache: ExtractionCache = {
  get: async () => undefined,
  set: async () => {},
};

// TODO: RedisExtractionCache backed by env.REDIS_URL with JSON (de)serialization.
