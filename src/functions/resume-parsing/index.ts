import { defineOcrFunction, OcrFunction } from "../define";
import { resumeParsingResultSchema } from "./result";
import { executeResumeParsing } from "./execute";
import { resumeParsingArgsSchema } from "./args";

export const resumeParsing = defineOcrFunction({
  key: OcrFunction.RESUME_PARSING,
  description: "Parse a resume into structured contact, experience, education, skills, and languages.",
  accepts: ["pdf", "image", "docx"],
  // layout so two-column PDFs can be reordered by bbox before interpretation — a
  // preference, since `execute` already falls back to `doc.markdown` when no block
  // carries a bbox. As a hard requirement it made DOCX resumes unroutable (→ 500):
  // mammoth is the only DOCX provider and it has no `layout`, and GLM does not
  // accept DOCX at all, so no configuration could have served them.
  requires: ["text"],
  prefers: ["layout"],
  sensitivity: "pii",
  maxPages: 10,
  argsSchema: resumeParsingArgsSchema,
  resultSchema: resumeParsingResultSchema,
  execute: executeResumeParsing,
});

export * from "./args";
export * from "./result";
