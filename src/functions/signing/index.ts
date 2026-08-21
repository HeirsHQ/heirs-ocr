import { defineOcrFunction, OcrFunction } from "../define";
import { signingResultSchema } from "./result";
import { executeSigning } from "./execute";
import { signingArgsSchema } from "./args";

export const signing = defineOcrFunction({
  key: OcrFunction.SIGNING,
  description: "Detect signatures and seals in an executed document and report execution status.",
  accepts: ["pdf", "image"],
  /**
   * `layout` only, though `seals` is what this function actually wants. The router
   * still prefers GLM-OCR (see `defaultProviderPolicy`), so the seal-capable path is
   * taken whenever GLM is up; requiring `seals` outright meant every request 500'd
   * with GLM off. `execute` reads `ctx.capabilities` and switches to whole-page
   * vision when `seals` is absent, marking the result `confidence: "low"`.
   */
  requires: ["layout"],
  sensitivity: "standard",
  maxPages: 30,
  argsSchema: signingArgsSchema,
  resultSchema: signingResultSchema,
  execute: executeSigning,
  // Surfaces degraded (whole-page) runs on the low-confidence quality SLI, so a
  // GLM outage shows up as a measurable drop rather than a silent quality change.
  confidenceOf: (r) => (r.confidence === "high" ? 1 : 0),
});

export * from "./args";
export * from "./result";
