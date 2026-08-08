import type { IdVerificationArgs } from "./args";
import { buildSystem, wrapUntrusted } from "../../llm/prompt";

export type Prompt = { system: string; user: string };

export const buildIdVerificationPrompt = (markdown: string, args: IdVerificationArgs): Prompt => {
  const typeHint =
    args.documentType === "AUTO"
      ? "Detect the document type (NIN, PASSPORT, DRIVERS_LICENSE, or VOTERS_CARD)."
      : `This is a ${args.documentType} document.`;

  const system = buildSystem([
    "You are an identity-document extraction assistant.",
    typeHint,
    "Extract full name, date of birth, document number, issue date, expiry date, nationality, sex,",
    "place of birth, and address. For driver's licences also extract the licence category and issuing authority.",
    "Use null for fields not present (e.g. licence category on a passport).",
    "Do NOT infer check-digit validity — that is computed separately.",
  ]);

  const user = `Extract identity fields from this document:\n\n${wrapUntrusted("DOCUMENT", markdown)}`;
  return { system, user };
};
