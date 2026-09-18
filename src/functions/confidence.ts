import type { RecognizedDocument } from "../providers/types";

/**
 * How far a result can be used without a human looking at it: a 0–1 score plus the
 * reason for every deduction taken off 1. Surfaced on every response as
 * `meta.confidence` / `meta.reviewReasons`; below `LOW_CONFIDENCE_THRESHOLD` the
 * pipeline sets `meta.needsReview`.
 *
 * The score is derived from evidence the service can check, never from a model
 * grading itself: OCR character confidence, deterministic verdicts (totals
 * reconciliation, MRZ checksums), the warnings those checks raise, and whether the
 * fields a function exists to find were actually found. Deductions multiply, so any
 * single failed check or missing key field is enough to fall below a 0.95 bar.
 */
export type ConfidenceAssessment = { score: number; reasons: string[] };

/** One multiplicative deduction and the reason a reviewer is shown for it. */
export type Deduction = { factor: number; reason: string };

/** A failed deterministic check (totals do not reconcile, MRZ checksum fails) halves the score. */
export const FAILED_CHECK_FACTOR = 0.5;

/** Each warning costs 10% — one warning on its own is enough to route a result to review. */
export const WARNING_FACTOR = 0.9;

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/**
 * Floors to three decimals so the reported score never rounds *up* across the review
 * threshold (0.9496 must not read as 0.95). The epsilon absorbs float noise such as
 * 0.95 * 1000 = 949.9999….
 */
const floor3 = (n: number): number => Math.floor(n * 1000 + 1e-9) / 1000;

export const percent = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** Folds deductions into an assessment. `null` entries are checks that passed. */
export const scoreFrom = (deductions: readonly (Deduction | null | undefined)[]): ConfidenceAssessment => {
  let score = 1;
  const reasons: string[] = [];
  for (const d of deductions) {
    if (!d) continue;
    score *= clamp01(d.factor);
    reasons.push(d.reason);
  }
  return { score: floor3(score), reasons };
};

/** Multiplies independent assessments (e.g. classification × the routed parser's result). */
export const combine = (...assessments: readonly ConfidenceAssessment[]): ConfidenceAssessment => ({
  score: floor3(assessments.reduce((acc, a) => acc * clamp01(a.score), 1)),
  reasons: assessments.flatMap((a) => a.reasons),
});

/** A "high"/"low" deterministic verdict, plus one deduction per warning it raised. */
export const verdictDeductions = (
  verdict: "high" | "low",
  warnings: readonly string[],
  failedReason: string,
): Deduction[] => [
  ...(verdict === "low" ? [{ factor: FAILED_CHECK_FACTOR, reason: failedReason }] : []),
  ...warnings.map((reason) => ({ factor: WARNING_FACTOR, reason })),
];

/** A value counts as found when it is neither null/undefined, blank text, nor an empty list/object. */
export const isPresent = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.values(value).some(isPresent);
  return true;
};

/**
 * Fill rate over the fields a function exists to find: `{ label → found }`. Scores
 * the fraction found and names the ones that were not.
 */
export const completeness = (fields: Record<string, boolean>): Deduction | null => {
  const labels = Object.keys(fields);
  if (labels.length === 0) return null;
  const missing = labels.filter((label) => !fields[label]);
  if (missing.length === 0) return null;
  return {
    factor: (labels.length - missing.length) / labels.length,
    reason: `Not found on the document: ${missing.join(", ")}.`,
  };
};

/**
 * Applies the extraction stage's own signal on top of a function's assessment. A
 * provider without a per-character signal (`ocrConfidence` absent — text layers are
 * exact, GLM-OCR exposes none) is neutral: the function's checks carry the score.
 */
export const withExtraction = (doc: RecognizedDocument, assessment: ConfidenceAssessment): ConfidenceAssessment => {
  const ocr = doc.ocrConfidence;
  if (ocr === undefined || ocr >= 1) return assessment;
  const reason = `OCR read the text at ${percent(ocr)} character confidence (${doc.provider}).`;
  return combine(scoreFrom([{ factor: ocr, reason }]), assessment);
};
