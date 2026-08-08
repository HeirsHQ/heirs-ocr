import type { ResumeParsingArgs } from "./args";
import { buildSystem, wrapUntrusted } from "../../llm/prompt";

export type Prompt = { system: string; user: string };

export const buildResumeParsingPrompt = (markdown: string, args: ResumeParsingArgs): Prompt => {
  const system = buildSystem([
    "You are a resume parsing assistant.",
    "Extract contact info, summary, experience, education, skills, certifications, and languages.",
    "Contact info includes nationality and any profile links (e.g. LinkedIn) in `links`.",
    "List memberships of professional bodies/associations in `professionalBodies`, separate from `certifications`.",
    "For skills and languages, capture a proficiency `level` when stated, otherwise null.",
    "For certifications, capture the issuer and date when present.",
    args.normalizeDates ? "Normalize all dates to ISO 8601 (YYYY-MM or YYYY-MM-DD)." : "Preserve dates as written.",
    "For current roles set current=true and endDate=null. Use null for missing scalar fields.",
  ]);

  const user = `Parse this resume:\n\n${wrapUntrusted("RESUME", markdown)}`;
  return { system, user };
};
