import type { MimeGroup } from "../providers/types";
import { analyzeImage } from "./image";
import { analyzePdf } from "./pdf";
import { aggregate } from "./signals";
import type { TamperSignals } from "./types";

export * from "./types";

/**
 * Runs the deterministic tamper-detection tier over raw uploaded bytes,
 * dispatching by container type. This is a cross-cutting signal — it can back the
 * DOCUMENT_AUTHENTICITY function and also be called from SIGNING / ID_VERIFICATION.
 *
 * Always heuristic (`assuranceLevel: "heuristic-only"`); see docs/tamper-detection.md.
 */
export const analyzeTamper = async (buffer: Buffer, mimeGroup: MimeGroup): Promise<TamperSignals> => {
  switch (mimeGroup) {
    case "pdf":
      return analyzePdf(buffer);
    case "image":
      return analyzeImage(buffer);
    default:
      return aggregate("unsupported", [], [`Tamper analysis is not supported for '${mimeGroup}' inputs.`]);
  }
};
