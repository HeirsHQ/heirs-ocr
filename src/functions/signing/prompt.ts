import { buildSystem, wrapUntrusted } from "../../llm/prompt";

export type Prompt = { system: string; user: string };

/**
 * Vision judgment over a cropped signature region. GLM-OCR labels
 * signatures and seals as `image` blocks, so the crop plus its nearby cue text
 * goes to the vision model to decide signed/unsigned and seal-present.
 *
 * @param cueContext - Nearby text (e.g. "For and on behalf of ... Director").
 */
export const buildSigningJudgmentPrompt = (cueContext: string): Prompt => {
  const system = buildSystem([
    "You are a signature-block analyst.",
    "Given a cropped region of an executed document and its surrounding label text,",
    "decide whether it contains a handwritten signature, whether a company seal/stamp is present,",
    "and read any signatory name and date. Report signed=false if the region is an empty signature line.",
  ]);

  const user = `${wrapUntrusted("SIGNATURE-BLOCK CONTEXT", cueContext)}\n\nJudge the attached crop.`;
  return { system, user };
};

/**
 * Whole-page vision judgment — the fallback for providers without `seals`, which
 * emit no `image` blocks to correlate against and so cannot locate regions at all.
 * The model does the locating *and* the judging in one pass over a full page image.
 *
 * It returns no geometry: asking a vision model for bounding boxes yields
 * plausible-looking but unreliable coordinates, and a wrong box is worse than an
 * absent one. `bbox` is omitted from these blocks and the result is marked
 * `confidence: "low"`.
 *
 * @param pageText - OCR text of the same page, as corroborating context.
 */
export const buildWholePageSigningPrompt = (pageText: string): Prompt => {
  const system = buildSystem([
    "You are a signature-block analyst examining one full page of a document.",
    "Find every signature block on the page — both completed and empty ones.",
    "For each, report a short label identifying it (use the printed caption where there is one,",
    'e.g. "Director", "Witness", "For and on behalf of X"), whether a handwritten signature is',
    "actually present, whether a company seal or stamp is present, and any signatory name and date.",
    "An empty ruled line, a blank box, or a caption with nothing written on it is signed=false.",
    "A typed name alone is not a signature. Do not invent blocks that are not visible on the page;",
    "return an empty list if the page carries no signature blocks at all.",
  ]);

  const user = `${wrapUntrusted("PAGE TEXT", pageText)}\n\nExamine the attached page image and report its signature blocks.`;
  return { system, user };
};
