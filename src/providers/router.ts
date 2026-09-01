import { policyForFunction, type ProviderPolicy } from "../config/providers";
import type { Capability, MimeGroup, OcrProvider } from "./types";
import type { OcrFunctionKey } from "../functions/define";
import { OcrError } from "../http/errors";

/**
 * Provider routing. Functions declare what they need;
 * providers declare what they have; the router matches. This is what prevents
 * silent wrong answers — a function needing `layout` can never be served by a
 * provider without bounding boxes.
 */
export type RoutingDecision = {
  provider: OcrProvider;
  fallbacks: OcrProvider[];
};

export type RouteInput = {
  group: MimeGroup;
  required: readonly Capability[];
  /**
   * Capabilities that rank a provider up without gating it out (the function's
   * `prefers`). Absent/empty leaves ordering to the policy chain alone.
   */
  preferred?: readonly Capability[];
  fn: OcrFunctionKey;
  policy: ProviderPolicy;
};

/** True if `provider` accepts the group and covers every required capability. */
export const providerSatisfies = (provider: OcrProvider, group: MimeGroup, required: readonly Capability[]): boolean =>
  provider.accepts.includes(group) && required.every((cap) => provider.capabilities.includes(cap));

/**
 * Selects a primary provider plus an ordered fallback chain.
 *
 * Rules: DOCX → mammoth always; PDF `text`-only → pdf-text first
 * then the scanned-PDF chain; PDF needing layout/seals/tables → skip pdf-parse,
 * use the scanned-PDF chain; image → the image chain. Providers that don't
 * satisfy the required capabilities are filtered out entirely; providers covering
 * every *preferred* capability are ranked ahead of those that don't, without
 * excluding anyone.
 *
 * @throws OcrError PROVIDER_UNAVAILABLE when no registered provider can satisfy
 * the request — a deployment/config state (an optional provider is switched off),
 * not a bug, so it must reach the caller as a typed 503 rather than a bare throw
 * the error middleware can only render as a 500.
 */
export const routeProvider = (registry: readonly OcrProvider[], input: RouteInput): RoutingDecision => {
  const policy = policyForFunction(input.policy, input.fn);
  const order = preferenceOrder(input, policy);

  // Resolve names → satisfying instances, preserving preference order, then
  // append any other satisfying provider as a last-resort fallback.
  const byName = new Map(registry.map((p) => [p.name, p]));
  const satisfies = (p: OcrProvider | undefined): p is OcrProvider =>
    !!p && providerSatisfies(p, input.group, input.required);

  const ordered: OcrProvider[] = [];
  const seen = new Set<string>();
  const push = (p: OcrProvider | undefined) => {
    if (satisfies(p) && !seen.has(p.name)) {
      ordered.push(p);
      seen.add(p.name);
    }
  };

  order.forEach((name) => push(byName.get(name)));
  registry.forEach(push);

  // Stable partition on the preferred capabilities: the policy chain still decides
  // the order within each tier, so this only moves a better-equipped provider up
  // past a lesser one — it never reorders two providers the policy ranked.
  const preferred = input.preferred ?? [];
  const covers = (p: OcrProvider): boolean => preferred.every((cap) => p.capabilities.includes(cap));
  const ranked = preferred.length === 0 ? ordered : [...ordered.filter(covers), ...ordered.filter((p) => !covers(p))];

  const [provider, ...fallbacks] = ranked;
  if (!provider) {
    throw new OcrError(
      "PROVIDER_UNAVAILABLE",
      `No provider satisfies ${input.group} with capabilities [${input.required.join(", ")}]`,
      { retryable: false, details: { group: input.group, required: input.required, function: input.fn } },
    );
  }
  return { provider, fallbacks };
};

/** The preferred provider-name order for a given input, before capability filtering. */
const preferenceOrder = (input: RouteInput, policy: ProviderPolicy): string[] => {
  switch (input.group) {
    case "docx":
      return ["mammoth"];
    case "text":
      return ["plain-text"];
    case "image":
      return [policy.image.primary, ...policy.image.fallbacks];
    case "pdf": {
      const scanned = [policy.scannedPdf.primary, ...policy.scannedPdf.fallbacks];
      // Preferred capabilities count here as well as required ones: a function that
      // merely *prefers* `tables`/`layout` still wants the OCR chain over the flat
      // digital text layer, which offers neither. Reading `required` alone would
      // quietly demote every PDF receipt to pdf-text the moment `tables` moved from
      // `requires` to `prefers`.
      const textOnly = [...input.required, ...(input.preferred ?? [])].every((c) => c === "text");
      // Text-only PDFs try the cheap digital text layer first; the scanned-PDF
      // chain covers the pages the per-page heuristic flags as scanned.
      return textOnly ? ["pdf-text", ...scanned] : scanned;
    }
  }
};
