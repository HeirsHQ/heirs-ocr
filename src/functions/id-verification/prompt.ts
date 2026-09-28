import { buildSystem, wrapUntrusted } from "../../llm/prompt";
import type { IdVerificationArgs } from "./args";

export type Prompt = { system: string; user: string };

export const buildIdVerificationPrompt = (markdown: string, args: IdVerificationArgs): Prompt => {
  const typeHint =
    args.documentType === "AUTO"
      ? "Detect the document type (NIN, PASSPORT, DRIVERS_LICENSE, or VOTERS_CARD)."
      : `This is a ${args.documentType} document.`;

  const system = buildSystem([
    "You are an identity-document extraction assistant.",
    typeHint,
    "Extract date of birth, document number, issue date, expiry date, nationality, sex,",
    "place of birth, and address. For driver's licences also extract the licence category and issuing authority.",
    "Return the holder's name as separate parts, never as one string: surname (family name), firstName,",
    "and middleName (every other given name). Decide which is which from the document's labels",
    "(Surname/Nom, First Name, Given Names/Prénoms, Middle Name, Other Names), not from word order.",
    "Where the parts are unlabelled, a name written as 'SURNAME, Given Names' puts the surname first.",
    "Copy every date exactly as printed. Do not reformat dates or reorder day and month; they are normalized separately.",
    "Use null for fields not present (e.g. licence category on a passport).",
    "Do NOT infer check-digit validity — that is computed separately.",
  ]);

  const user = `Extract identity fields from this document:\n\n${wrapUntrusted("DOCUMENT", markdown)}`;
  return { system, user };
};
