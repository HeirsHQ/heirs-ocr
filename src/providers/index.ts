import { PlainTextProvider } from "./plain-text";
import { TesseractProvider } from "./tesseract";
import { PdfTextProvider } from "./pdf-text";
import { MammothProvider } from "./mammoth";
import type { OcrProvider } from "./types";
import { GlmClient } from "./glm/client";
import { GlmOcrProvider } from "./glm";
import { env } from "../config/env";

/**
 * Composition root for the extraction layer. Builds the concrete provider
 * instances and exposes them as the registry the router matches against.
 */
export const buildProviderRegistry = (): OcrProvider[] => {
  const glmClient = new GlmClient({ apiKey: env.GLM_API_KEY ?? "", baseUrl: env.GLM_BASE_URL });
  return [
    new PlainTextProvider(),
    new PdfTextProvider(),
    new MammothProvider(),
    new TesseractProvider(),
    new GlmOcrProvider(glmClient),
  ];
};

export const providerRegistry: OcrProvider[] = buildProviderRegistry();

export * from "./types";
