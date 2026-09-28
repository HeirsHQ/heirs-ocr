import { z } from "zod";

import { idDocumentTypeSchema } from "./args";

export const idVerificationResultSchema = z.object({
  documentType: idDocumentTypeSchema,
  fields: z.object({
    /**
     * Composed in code as `FIRST MIDDLE SURNAME` from the parts below, so the order is the
     * same on every run whatever order the document prints them in.
     */
    fullName: z.string().nullable(),
    surname: z.string().nullable(),
    firstName: z.string().nullable(),
    /** Every given name after the first, space-separated. */
    middleName: z.string().nullable(),
    /** Dates are ISO `YYYY-MM-DD` whatever format the document prints; the printed text only when unreadable. */
    dateOfBirth: z.string().nullable(),
    documentNumber: z.string().nullable(),
    issueDate: z.string().nullable(),
    expiryDate: z.string().nullable(),
    nationality: z.string().nullable(),
    sex: z.string().nullable(),
    placeOfBirth: z.string().nullable(),
    address: z.string().nullable(),
    /** Driver's-licence vehicle categories (e.g. "B, C1"); null on other document types. */
    licenceCategory: z.string().nullable(),
    /** Authority that issued the document (e.g. FRSC, immigration service). */
    issuingAuthority: z.string().nullable(),
  }),
  checks: z.object({
    expired: z.boolean().nullable(),
    /** ISO `YYYY-MM-DD` when the printed date could be read; the printed text otherwise. */
    expiryDate: z.string().nullable(),
    nameMatch: z.boolean().nullable(),
    dobMatch: z.boolean().nullable(),
    numberMatch: z.boolean().nullable(),
    /** Deterministic MRZ checksum validity (passports); null when no MRZ present. */
    mrzValid: z.boolean().nullable(),
  }),
  /** Scope honesty: this verifies document-content consistency, not identity. */
  assuranceLevel: z.literal("document-content-only"),
});

export type IdVerificationResult = z.infer<typeof idVerificationResultSchema>;
