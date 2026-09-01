import { defineOcrFunction, OcrFunction } from "../define";
import { signingResultSchema } from "./result";
import { executeSigning } from "./execute";
import { signingArgsSchema } from "./args";

export const signing = defineOcrFunction({
  key: OcrFunction.SIGNING,
  description: "Detect signatures and seals in an executed document and report execution status.",
  accepts: ["pdf", "image"],
  /**
   * `layout` is the floor; `seals` is what this function actually wants. Requiring
   * `seals` outright meant every request 500'd with GLM off, so it is declared as a
   * preference: the router ranks a seal-capable provider first without excluding the
   * others, and `execute` reads `ctx.capabilities` to switch to whole-page vision
   * when `seals` is absent, marking the result `confidence: "low"`.
   *
   * Declared here rather than left to `defaultProviderPolicy` happening to name
   * GLM-OCR primary: that made the seal-capable path depend on a config file no test
   * tied to this function, so a policy edit could silently drop SIGNING to whole-page
   * vision. Routing is unchanged today — this only pins the reason.
   */
  requires: ["layout"],
  prefers: ["seals"],
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
