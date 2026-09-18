import { z } from "zod";

export const idDocumentTypeSchema = z.enum(["NIN", "PASSPORT", "DRIVERS_LICENSE", "VOTERS_CARD", "AUTO"]);
export type IdDocumentType = z.infer<typeof idDocumentTypeSchema>;

export const idVerificationArgsSchema = z.object({
  documentType: idDocumentTypeSchema
    .default("AUTO")
    .describe("Which kind of ID this is. Leave on AUTO to let it work that out from the document."),
  expected: z
    .object({
      fullName: z
        .string()
        .optional()
        .describe("The name you have on file, in any order, checked against the one on the ID."),
      dateOfBirth: z
        .string()
        .optional()
        .describe("The date of birth you have on file, in any common format (e.g. 1990-04-03, 03/04/1990)."),
      documentNumber: z.string().optional().describe("The ID number you have on file."),
    })
    .optional()
    .describe("What you already hold for this person. Anything you fill in is compared against the ID and reported."),
});

export type IdVerificationArgs = z.infer<typeof idVerificationArgsSchema>;
