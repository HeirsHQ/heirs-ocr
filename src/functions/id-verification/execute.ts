import { z } from "zod";

import { composeFullName, namesMatch, normalizeNameParts, type NameParts } from "./names";
import { isExpired, datesMatch, normalizeIdDate } from "./dates";
import { idVerificationResultSchema } from "./result";
import type { IdVerificationResult } from "./result";
import { buildIdVerificationPrompt } from "./prompt";
import { parseMrz, type MrzFields } from "./mrz";
import type { IdVerificationArgs } from "./args";
import { idDocumentTypeSchema } from "./args";
import type { OcrContext } from "../define";

/**
 * The model extracts only the raw fields + document type — never the `checks`,
 * which are computed deterministically here. Asking the LLM to judge its own
 * check digits or expiry is exactly the silent-failure trap MRZ parsing exists
 * to avoid. Likewise it returns name *parts*, not `fullName`: the order of a full
 * name is fixed in code (see names.ts).
 */
const idExtractionSchema = z.object({
  documentType: idDocumentTypeSchema,
  fields: idVerificationResultSchema.shape.fields.omit({ fullName: true }),
});
type IdExtraction = z.infer<typeof idExtractionSchema>;
type Fields = IdVerificationResult["fields"];

/**
 * Extracts ID fields, parses MRZ deterministically, and computes the `checks`
 * block. When MRZ validates, prefer its fields over the LLM's for the fields it
 * covers. Names and dates are normalized in code — names to fixed-order uppercase
 * parts, dates to ISO — so the same file reads the same on every run and the
 * expected-value checks ignore word order and date format. `assuranceLevel` is
 * always "document-content-only" — this is not identity assurance.
 *
 * Data residency: for `pii` this must route through a self-hosted GLM or Azure
 * vision, never the China-hosted GLM endpoint.
 */
export const executeIdVerification = async (
  ctx: OcrContext,
  args: IdVerificationArgs,
): Promise<IdVerificationResult> => {
  const { system, user } = buildIdVerificationPrompt(ctx.doc.markdown, args);

  const { data: extracted } = await ctx.llm.complete<IdExtraction>({
    system,
    user,
    schema: idExtractionSchema,
    schemaName: "ID_VERIFICATION_extraction",
  });

  const mrz = parseMrz(ctx.doc.markdown);
  const merged = mrz?.valid ? mergeMrzFields(extracted.fields, mrz.fields) : extracted.fields;
  const fields = normalizeFields(merged);

  const expected = args.expected;
  const checks: IdVerificationResult["checks"] = {
    expiryDate: fields.expiryDate,
    expired: isExpired(fields.expiryDate),
    nameMatch: expected?.fullName != null ? namesMatch(fields.fullName, expected.fullName) : null,
    dobMatch: expected?.dateOfBirth != null ? datesMatch(fields.dateOfBirth, expected.dateOfBirth) : null,
    numberMatch: expected?.documentNumber != null ? alnumMatch(fields.documentNumber, expected.documentNumber) : null,
    mrzValid: mrz ? mrz.valid : null,
  };

  return {
    documentType: extracted.documentType,
    fields,
    checks,
    assuranceLevel: "document-content-only",
  };
};

type ExtractedFields = IdExtraction["fields"];

/**
 * MRZ wins for the fields it covers, but only overwrites when it actually read a
 * value. Fields the MRZ doesn't carry (issue date, place of birth, address,
 * licence category, issuing authority) pass through from the LLM via the spread.
 * The MRZ's surname/given-names split is structural, so it also settles the parts.
 */
const mergeMrzFields = (llm: ExtractedFields, mrz: MrzFields): ExtractedFields => ({
  ...llm,
  ...(mrz.surname ? { surname: mrz.surname } : {}),
  ...(mrz.givenNames ? { firstName: mrz.givenNames, middleName: null } : {}),
  dateOfBirth: mrz.dateOfBirth ?? llm.dateOfBirth,
  documentNumber: mrz.documentNumber ?? llm.documentNumber,
  expiryDate: mrz.expiryDate ?? llm.expiryDate,
  nationality: mrz.nationality ?? llm.nationality,
  sex: mrz.sex ?? llm.sex,
});

/** Fixed-order name parts + composed `fullName`, and ISO dates (past for birth/issue, forward for expiry). */
const normalizeFields = (raw: ExtractedFields): Fields => {
  const parts: NameParts = normalizeNameParts(raw);
  return {
    ...raw,
    ...parts,
    fullName: composeFullName(parts),
    dateOfBirth: normalizeIdDate(raw.dateOfBirth, "past"),
    issueDate: normalizeIdDate(raw.issueDate, "past"),
    expiryDate: normalizeIdDate(raw.expiryDate, "future"),
  };
};

/** Alphanumeric-only comparison (drops separators/case in document numbers). */
const alnumMatch = (actual: string | null, expected: string): boolean => {
  if (actual == null) return false;
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return norm(actual) === norm(expected);
};
