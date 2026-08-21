import sharp from "sharp";
import { z } from "zod";

import { buildSigningJudgmentPrompt, buildWholePageSigningPrompt } from "./prompt";
import type { LayoutBlock } from "../../providers/types";
import type { SigningResult } from "./result";
import type { OcrContext } from "../define";
import type { SigningArgs } from "./args";

type SignatureBlock = SigningResult["blocks"][number];
type Bbox = [number, number, number, number];

/** Center-to-center distance below which a cue label and an image block are "correlated". */
const CORRELATION_THRESHOLD = 0.25;
/** Padding (fraction of the page) added around a crop so the mark isn't clipped. */
const CROP_PADDING = 0.02;

const DEGRADED_WARNING =
  "Extraction ran on a provider without `seals`, so signature regions could not be located. " +
  "Judged from whole-page images instead: block geometry is absent and detection is less reliable. " +
  "Treat `fullyExecuted` as indicative, not authoritative.";

/** The model reports only the raw judgment; execution status is derived here. */
const signingJudgmentSchema = z.object({
  signed: z.boolean(),
  hasSeal: z.boolean(),
  signatoryName: z.string().nullable(),
  signedDate: z.string().nullable(),
});
type SigningJudgment = z.infer<typeof signingJudgmentSchema>;

/** One whole-page pass returns every block it can see, since nothing pre-located them. */
const wholePageJudgmentSchema = z.object({
  blocks: z.array(signingJudgmentSchema.extend({ label: z.string() })),
});
type WholePageJudgment = z.infer<typeof wholePageJudgmentSchema>;

/** A correlated (cue label, signature image) pairing — an expected signature slot. */
type Slot = { label: string; page: number; bbox: Bbox; image: LayoutBlock | null; context: string };

/**
 * Determines whether an executed document is fully signed, where, and by whom.
 *
 * Two strategies, picked from what the extraction provider actually offered:
 *
 *  - **Region detection** (`seals`-capable provider, i.e. GLM-OCR): find `image`
 *    blocks, correlate each against nearby cue text, crop the region and send it to
 *    the vision model. Precise geometry, one cheap crop per slot → `confidence: "high"`.
 *  - **Whole-page vision** (any other provider): no `image` blocks exist to correlate,
 *    so rasterize the candidate pages and let the vision model both locate and judge.
 *    Costlier, no geometry, less reliable → `confidence: "low"` plus a warning.
 *
 * The fallback exists so SIGNING still answers when GLM is off or down. It degrades
 * loudly: the alternative — running region detection against a provider that emits no
 * `image` blocks — reports a fully executed contract as entirely unsigned, with
 * nothing in the response to say the detector was blind.
 */
export const executeSigning = async (ctx: OcrContext, args: SigningArgs): Promise<SigningResult> => {
  if (!ctx.capabilities.includes("seals")) return executeWholePage(ctx, args);

  const slots = correlateSlots(ctx.doc.blocks, args.signatureCues);

  // Geometry-only probe: report the located slots, skip the vision (and LLM) pass.
  if (args.geometryOnly) {
    const blocks = slots.map((slot) => toBlock(slot, { signed: false, hasSeal: false }));
    return assemble(blocks, "high", []);
  }

  // Rasterize each page that carries a detected signature image, once.
  const pagesNeeded = new Set(slots.filter((s) => s.image).map((s) => s.page));
  const pageImages = await rasterizePages(ctx.file, pagesNeeded);

  const blocks: SignatureBlock[] = [];
  for (const slot of slots) {
    // No image correlated to the cue means no mark was detected — an empty slot.
    if (!slot.image) {
      blocks.push(toBlock(slot, { signed: false, hasSeal: false }));
      continue;
    }
    const pageImage = pageImages.get(slot.page);
    if (!pageImage) {
      blocks.push(toBlock(slot, { signed: false, hasSeal: false }));
      continue;
    }
    const crop = await cropRegion(pageImage, slot.bbox);
    const { system, user } = buildSigningJudgmentPrompt(slot.context);
    const { data } = await ctx.llm.complete<SigningJudgment>({
      system,
      user,
      images: [crop],
      schema: signingJudgmentSchema,
      schemaName: "SIGNING_judgment",
    });
    blocks.push(toBlock(slot, data));
  }

  return assemble(blocks, "high", []);
};

/**
 * Whole-page fallback: one vision call per candidate page, no region detection.
 * Always `confidence: "low"` — the caller must be able to tell this ran.
 */
const executeWholePage = async (ctx: OcrContext, args: SigningArgs): Promise<SigningResult> => {
  const warnings = [DEGRADED_WARNING];

  // Locating regions is exactly what this path cannot do, so a geometry probe has
  // no honest answer to give. Say so rather than returning word boxes as if they
  // were signature blocks.
  if (args.geometryOnly) {
    warnings.push("`geometryOnly` requires a `seals`-capable provider; no block geometry was produced.");
    return assemble([], "low", warnings);
  }

  const { pages, truncated } = selectVisionPages(ctx, args);
  if (truncated) {
    warnings.push(
      `More candidate pages than the \`maxVisionPages\` budget of ${args.maxVisionPages}; ` +
        `scanned pages ${pages.join(", ")} only. Raise \`maxVisionPages\` to widen the scan.`,
    );
  }

  const pageImages = await rasterizePages(ctx.file, new Set(pages));

  const blocks: SignatureBlock[] = [];
  for (const page of pages) {
    const pageImage = pageImages.get(page);
    if (!pageImage) {
      warnings.push(`Page ${page} could not be rasterized and was not examined.`);
      continue;
    }
    const { system, user } = buildWholePageSigningPrompt(pageText(ctx, page));
    const { data } = await ctx.llm.complete<WholePageJudgment>({
      system,
      user,
      images: [`data:image/png;base64,${pageImage.toString("base64")}`],
      schema: wholePageJudgmentSchema,
      schemaName: "SIGNING_whole_page",
    });
    for (const judged of data.blocks) {
      blocks.push({
        label: judged.label,
        page,
        signed: judged.signed,
        hasSeal: judged.hasSeal,
        ...(judged.signatoryName ? { signatoryName: judged.signatoryName } : {}),
        ...(judged.signedDate ? { signedDate: judged.signedDate } : {}),
      });
    }
  }

  if (blocks.length === 0) {
    warnings.push("No signature blocks were identified on the scanned pages.");
  }
  return assemble(blocks, "low", warnings);
};

/**
 * Chooses which pages the whole-page pass should rasterize. Pages whose OCR text
 * carries a cue phrase are the candidates; failing that, the last page, where
 * execution blocks usually sit. Later pages win when the budget binds, for the
 * same reason.
 */
const selectVisionPages = (ctx: OcrContext, args: SigningArgs): { pages: number[]; truncated: boolean } => {
  const lastPage = Math.max(1, ctx.doc.pageCount);
  const cued = ctx.doc.pages.filter((p) => matchCue(p.markdown, args.signatureCues) !== null).map((p) => p.page);
  const candidates = cued.length > 0 ? cued : [lastPage];

  if (candidates.length <= args.maxVisionPages) return { pages: candidates, truncated: false };
  return { pages: candidates.slice(-args.maxVisionPages), truncated: true };
};

const pageText = (ctx: OcrContext, page: number): string =>
  (ctx.doc.pages.find((p) => p.page === page)?.markdown ?? "").slice(0, 4000);

/** fullyExecuted only when there is at least one slot and every slot is signed. */
const assemble = (
  blocks: SignatureBlock[],
  confidence: SigningResult["confidence"],
  warnings: string[],
): SigningResult => ({
  fullyExecuted: blocks.length > 0 && blocks.every((b) => b.signed),
  blocks,
  unsignedBlocks: blocks.filter((b) => !b.signed).map((b) => b.label),
  confidence,
  warnings,
});

/**
 * Pairs cue-text blocks (the expected signature labels) with the nearest
 * signature `image` block on the same page. Multiple cues near one image collapse
 * into a single slot; a cue with no nearby image is an unsigned (empty) slot.
 */
const correlateSlots = (allBlocks: readonly LayoutBlock[], cues: readonly string[]): Slot[] => {
  const images = allBlocks.filter((b): b is LayoutBlock & { bbox: Bbox } => b.label === "image" && !!b.bbox);
  const byImage = new Map<number, Slot>();
  const orphans: Slot[] = [];

  for (const block of allBlocks) {
    if (block.label === "image" || !block.bbox) continue;
    const cue = matchCue(block.content, cues);
    if (!cue) continue;

    const image = nearestImage(block.bbox, block.page, images);
    if (image) {
      const existing = byImage.get(image.index);
      if (existing) {
        existing.context = `${existing.context}\n${block.content}`.trim().slice(0, 800);
      } else {
        byImage.set(image.index, {
          label: cue,
          page: block.page,
          bbox: image.bbox,
          image,
          context: block.content.trim(),
        });
      }
    } else {
      orphans.push({ label: cue, page: block.page, bbox: block.bbox, image: null, context: block.content.trim() });
    }
  }

  return [...byImage.values(), ...orphans];
};

/** Returns the first cue phrase present in `content` (case-insensitive), or null. */
const matchCue = (content: string, cues: readonly string[]): string | null => {
  const haystack = content.toLowerCase();
  for (const cue of cues) {
    if (haystack.includes(cue.toLowerCase())) return cue;
  }
  return null;
};

/** Nearest same-page image block within {@link CORRELATION_THRESHOLD}, or null. */
const nearestImage = (
  bbox: Bbox,
  page: number,
  images: readonly (LayoutBlock & { bbox: Bbox })[],
): (LayoutBlock & { bbox: Bbox }) | null => {
  let best: (LayoutBlock & { bbox: Bbox }) | null = null;
  let bestDist = CORRELATION_THRESHOLD;
  for (const image of images) {
    if (image.page !== page) continue;
    const d = distance(bbox, image.bbox);
    if (d <= bestDist) {
      bestDist = d;
      best = image;
    }
  }
  return best;
};

const center = (b: Bbox): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

const distance = (a: Bbox, b: Bbox): number => {
  const [ax, ay] = center(a);
  const [bx, by] = center(b);
  return Math.hypot(ax - bx, ay - by);
};

type Judgment = { signed: boolean; hasSeal: boolean; signatoryName?: string | null; signedDate?: string | null };

const toBlock = (slot: Slot, judgment: Judgment): SignatureBlock => ({
  label: slot.label,
  page: slot.page,
  bbox: slot.bbox,
  signed: judgment.signed,
  hasSeal: judgment.hasSeal,
  ...(judgment.signatoryName ? { signatoryName: judgment.signatoryName } : {}),
  ...(judgment.signedDate ? { signedDate: judgment.signedDate } : {}),
});

/** Rasterizes the requested pages to PNG buffers. Images are single-page (page 1). */
const rasterizePages = async (file: OcrContext["file"], pages: Set<number>): Promise<Map<number, Buffer>> => {
  const out = new Map<number, Buffer>();
  if (pages.size === 0) return out;

  if (file.mimeGroup === "image") {
    for (const page of pages) out.set(page, file.buffer);
    return out;
  }

  const { pdf } = await import("pdf-to-img");
  const doc = await pdf(file.buffer, { scale: 2 });
  const max = Math.max(...pages);
  let page = 0;
  for await (const image of doc) {
    page++;
    if (pages.has(page)) out.set(page, image);
    if (page >= max) break;
  }
  return out;
};

/** Crops the normalized bbox (0–1) out of a page image and returns a PNG data URI. */
const cropRegion = async (pageImage: Buffer, bbox: Bbox): Promise<string> => {
  const meta = await sharp(pageImage).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) throw new Error("cropRegion: could not read page image dimensions");

  const x0 = clamp01(bbox[0] - CROP_PADDING);
  const y0 = clamp01(bbox[1] - CROP_PADDING);
  const x1 = clamp01(bbox[2] + CROP_PADDING);
  const y1 = clamp01(bbox[3] + CROP_PADDING);

  const left = Math.min(Math.floor(x0 * width), width - 1);
  const top = Math.min(Math.floor(y0 * height), height - 1);
  const cropWidth = Math.max(1, Math.min(Math.ceil((x1 - x0) * width), width - left));
  const cropHeight = Math.max(1, Math.min(Math.ceil((y1 - y0) * height), height - top));

  const buffer = await sharp(pageImage).extract({ left, top, width: cropWidth, height: cropHeight }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString("base64")}`;
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
