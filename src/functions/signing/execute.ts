import type { OcrContext } from "../define";
import type { SigningArgs } from "./args";
import type { SigningResult } from "./result";

/**
 * Determines whether an executed document is fully signed, where, and by whom
 * (spec pending confirmation). Detection is geometric +
 * contextual: find `image` blocks, correlate against nearby cue text, then send
 * crops (`return_crop_images: true`) to the vision model for signed/seal
 * judgments. Depends on GLM-OCR's seal strength; Tesseract is not a viable
 * fallback here — fail closed rather than degrade.
 */
export const executeSigning = async (_ctx: OcrContext, _args: SigningArgs): Promise<SigningResult> => {
  // TODO: locate image blocks → correlate cues → (geometryOnly? return blocks) → vision judge crops.
  throw new Error("executeSigning: not implemented");
};
