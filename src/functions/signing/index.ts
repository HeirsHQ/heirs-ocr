import { defineOcrFunction, OcrFunction } from "../define";
import { signingResultSchema } from "./result";
import { executeSigning } from "./execute";
import { signingArgsSchema } from "./args";

export const signing = defineOcrFunction({
  key: OcrFunction.SIGNING,
  description: "Detect signatures and seals in an executed document and report execution status.",
  accepts: ["pdf", "image"],
  requires: ["layout", "seals"],
  sensitivity: "standard",
  maxPages: 30,
  argsSchema: signingArgsSchema,
  resultSchema: signingResultSchema,
  execute: executeSigning,
});

export * from "./args";
export * from "./result";
