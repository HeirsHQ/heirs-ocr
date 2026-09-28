import { FAILED_CHECK_FACTOR, completeness, isPresent, scoreFrom, type ConfidenceAssessment } from "../confidence";
import type { IdVerificationResult } from "./result";

/**
 * Key-field fill rate, then the deterministic checks. A failed MRZ checksum means the
 * machine-readable zone was misread; a mismatch against the caller's expected values
 * is either a misread or a genuine discrepancy — both are for a person to decide.
 * Expiry is not scored: it is a date read, not a doubt about the read.
 */
export const assessIdVerification = (result: IdVerificationResult): ConfidenceAssessment => {
  const { fields, checks } = result;
  const failed = (check: boolean | null, reason: string) =>
    check === false ? { factor: FAILED_CHECK_FACTOR, reason } : null;

  return scoreFrom([
    completeness({
      "full name": isPresent(fields.fullName),
      "date of birth": isPresent(fields.dateOfBirth),
      "document number": isPresent(fields.documentNumber),
    }),
    failed(checks.mrzValid, "MRZ checksum failed; machine-readable fields may be misread."),
    failed(checks.nameMatch, "Name on the document does not match the expected name."),
    failed(checks.dobMatch, "Date of birth on the document does not match the expected date."),
    failed(checks.numberMatch, "Document number does not match the expected number."),
  ]);
};
