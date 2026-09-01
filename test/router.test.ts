import { describe, expect, it } from "vitest";

import { providerSatisfies, routeProvider } from "../src/providers/router";
import { defaultProviderPolicy } from "../src/config/providers";
import { listFunctions } from "../src/functions/registry";
import { buildProviderRegistry } from "../src/providers";
import { receiptParsing } from "../src/functions/receipt-parsing";
import { resumeParsing } from "../src/functions/resume-parsing";
import { signing } from "../src/functions/signing";
import type {
  Capability,
  DocumentInput,
  MimeGroup,
  OcrProvider,
  RecognizedDocument,
  RecognizeOptions,
} from "../src/providers/types";

/** Minimal fake provider — the router only inspects name/accepts/capabilities. */
const fakeProvider = (name: string, accepts: MimeGroup[], capabilities: Capability[]): OcrProvider => ({
  name,
  accepts,
  capabilities,
  recognize: async (_input: DocumentInput, _opts: RecognizeOptions): Promise<RecognizedDocument> => {
    throw new Error("not used in routing tests");
  },
});

const glm = fakeProvider("glm-ocr", ["pdf", "image"], ["text", "layout", "tables", "handwriting", "seals"]);
const tesseract = fakeProvider("tesseract", ["image", "pdf"], ["text", "layout"]);
const pdfText = fakeProvider("pdf-text", ["pdf"], ["text"]);
const plainText = fakeProvider("plain-text", ["text"], ["text"]);
const mammoth = fakeProvider("mammoth", ["docx"], ["text", "tables"]);

const registry = [plainText, pdfText, mammoth, tesseract, glm];

describe("providerSatisfies", () => {
  it("requires the group and every capability", () => {
    expect(providerSatisfies(glm, "image", ["seals"])).toBe(true);
    expect(providerSatisfies(tesseract, "image", ["seals"])).toBe(false);
    expect(providerSatisfies(tesseract, "docx", ["text"])).toBe(false);
  });
});

describe("routeProvider", () => {
  it("routes images to GLM primary with Tesseract fallback", () => {
    const { provider, fallbacks } = routeProvider(registry, {
      group: "image",
      required: ["text"],
      fn: "DOCUMENT_CLASSIFICATION",
      policy: defaultProviderPolicy,
    });
    expect(provider.name).toBe("glm-ocr");
    expect(fallbacks.map((p) => p.name)).toContain("tesseract");
  });

  it("honors the TEXT_EXTRACTION override (Tesseract primary for images)", () => {
    const { provider, fallbacks } = routeProvider(registry, {
      group: "image",
      required: ["text"],
      fn: "TEXT_EXTRACTION",
      policy: defaultProviderPolicy,
    });
    expect(provider.name).toBe("tesseract");
    expect(fallbacks.map((p) => p.name)).toContain("glm-ocr");
  });

  it("filters out providers lacking a required capability (seals ⇒ only GLM)", () => {
    const { provider, fallbacks } = routeProvider(registry, {
      group: "image",
      required: ["layout", "seals"],
      fn: "SIGNING",
      policy: defaultProviderPolicy,
    });
    expect(provider.name).toBe("glm-ocr");
    // Tesseract lacks `seals`, so it must not appear even as a fallback.
    expect(fallbacks.map((p) => p.name)).not.toContain("tesseract");
  });

  it("prefers the digital text layer for text-only PDFs", () => {
    const { provider } = routeProvider(registry, {
      group: "pdf",
      required: ["text"],
      fn: "TEXT_EXTRACTION",
      policy: defaultProviderPolicy,
    });
    expect(provider.name).toBe("pdf-text");
  });

  it("skips pdf-text for PDFs needing layout", () => {
    const { provider } = routeProvider(registry, {
      group: "pdf",
      required: ["layout"],
      fn: "SIGNING",
      policy: defaultProviderPolicy,
    });
    expect(provider.name).toBe("glm-ocr");
  });

  it("routes DOCX to mammoth always", () => {
    const { provider } = routeProvider(registry, {
      group: "docx",
      required: ["text"],
      fn: "TEXT_EXTRACTION",
      policy: defaultProviderPolicy,
    });
    expect(provider.name).toBe("mammoth");
  });

  it("throws when no provider satisfies the request", () => {
    // GLM absent (disabled): nothing offers `seals`.
    const noSeals = [plainText, pdfText, mammoth, tesseract];
    expect(() =>
      routeProvider(noSeals, { group: "image", required: ["seals"], fn: "SIGNING", policy: defaultProviderPolicy }),
    ).toThrow(/No provider satisfies/);
  });

  // Regression: SIGNING declared `requires: ["layout", "seals"]`, so with GLM
  // disabled nothing satisfied it and every request 500'd on the routing throw.
  // Its `requires` is now a floor — the function degrades to whole-page vision —
  // so routing must succeed on Tesseract while still preferring GLM when present.
  describe("SIGNING routes with GLM disabled", () => {
    const routeSigning = (reg: OcrProvider[], group: MimeGroup, policy = defaultProviderPolicy) =>
      routeProvider(reg, {
        group,
        required: signing.requires,
        preferred: signing.prefers,
        fn: signing.key,
        policy,
      });

    it("prefers GLM when it is registered", () => {
      expect(routeSigning(registry, "image").provider.name).toBe("glm-ocr");
    });

    it("falls back to tesseract instead of throwing when GLM is absent", () => {
      const noGlm = [plainText, pdfText, mammoth, tesseract];
      for (const group of ["image", "pdf"] as const) {
        expect(routeSigning(noGlm, group).provider.name).toBe("tesseract");
      }
    });

    // `prefers: ["seals"]` is what keeps the seal-capable path selected, not the
    // policy naming glm-ocr first. Under a policy that leads with Tesseract, SIGNING
    // must still reach GLM — otherwise a routine policy edit silently downgrades every
    // signature check to whole-page vision, which no other test would catch.
    it("still leads with the seal-capable provider under a tesseract-first policy", () => {
      const tesseractFirst = {
        image: { primary: "tesseract", fallbacks: ["glm-ocr"] },
        scannedPdf: { primary: "tesseract", fallbacks: ["glm-ocr"] },
      };
      for (const group of ["image", "pdf"] as const) {
        expect(routeSigning(registry, group, tesseractFirst).provider.name).toBe("glm-ocr");
      }
    });
  });

  // Regression: RECEIPT_PARSING gated on `tables` and RESUME_PARSING on `layout`,
  // both of which only GLM offers for image/pdf (and nothing offers for DOCX). With
  // GLM_ENABLED off every call to them threw here — a bare Error the middleware could
  // only render as `500 INTERNAL`, on every file and every argument.
  //
  // The narrow fix (relaxing `requires`) is not enough on its own: with `tables` gone
  // from `required`, a PDF looks "text-only" to `preferenceOrder` and silently demotes
  // to pdf-text. So these assert the ranking too, not just that routing succeeds.
  describe("preferred capabilities rank without gating", () => {
    const realRegistry = buildProviderRegistry();
    const withoutGlm = realRegistry.filter((p) => p.name !== "glm-ocr");
    const withGlm = [...withoutGlm, glm];

    const route = (fn: typeof receiptParsing | typeof resumeParsing, group: MimeGroup, reg: OcrProvider[]) =>
      routeProvider(reg, {
        group,
        required: fn.requires,
        preferred: fn.prefers,
        fn: fn.key,
        policy: defaultProviderPolicy,
      });

    it("still prefers GLM for receipts when it is registered", () => {
      // Including PDF: `prefers: ["tables"]` must keep receipts off the flat digital
      // text layer, which is what `required`-only text-only detection would pick.
      expect(route(receiptParsing, "image", withGlm).provider.name).toBe("glm-ocr");
      expect(route(receiptParsing, "pdf", withGlm).provider.name).toBe("glm-ocr");
    });

    it("degrades receipts to tesseract instead of throwing when GLM is absent", () => {
      expect(route(receiptParsing, "image", withoutGlm).provider.name).toBe("tesseract");
      expect(route(receiptParsing, "pdf", withoutGlm).provider.name).toBe("tesseract");
    });

    it("routes DOCX resumes to mammoth, which has no layout at all", () => {
      // GLM does not accept DOCX, so this case is unfixable by configuration —
      // `layout` has to be a preference for a .docx resume to be servable.
      expect(route(resumeParsing, "docx", withGlm).provider.name).toBe("mammoth");
      expect(route(resumeParsing, "docx", withoutGlm).provider.name).toBe("mammoth");
    });

    it("keeps layout-capable providers ahead of pdf-text for PDF resumes", () => {
      const { provider, fallbacks } = route(resumeParsing, "pdf", withoutGlm);
      expect(provider.name).toBe("tesseract");
      // pdf-text may still catch a total tesseract failure, but never lead.
      expect(fallbacks.map((p) => p.name)).toEqual(["pdf-text"]);
    });
  });

  // The guard the two bugs above needed: every catalogued function must be routable
  // for every mime group it advertises, against the providers that are actually
  // registered by default. Each per-function test drives runPipeline with a fake
  // provider that satisfies everything, so none of them can catch an unroutable
  // declaration — only walking the real registry does.
  it("routes every catalogued function/mime combination with GLM disabled", () => {
    const withoutGlm = buildProviderRegistry().filter((p) => p.name !== "glm-ocr");
    const unroutable: string[] = [];

    for (const def of listFunctions()) {
      // skipExtraction functions work on raw bytes and never reach the router.
      if (def.skipExtraction) continue;
      for (const group of def.accepts) {
        try {
          routeProvider(withoutGlm, {
            group,
            required: def.requires,
            preferred: def.prefers,
            fn: def.key,
            policy: defaultProviderPolicy,
          });
        } catch (err) {
          unroutable.push(`${def.key}/${group}: ${(err as Error).message}`);
        }
      }
    }

    expect(unroutable).toEqual([]);
  });
});
