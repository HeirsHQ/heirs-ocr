import { completeness, isPresent, scoreFrom, type ConfidenceAssessment } from "../confidence";
import type { ResumeParsingResult } from "./result";

/** Key-field fill rate: a resume without a name, a way to reach them, or any history needs a person to look. */
export const assessResumeParsing = (result: ResumeParsingResult): ConfidenceAssessment =>
  scoreFrom([
    completeness({
      "candidate name": isPresent(result.contact.name),
      "email or phone": isPresent(result.contact.email) || isPresent(result.contact.phone),
      "experience or education": result.experience.length + result.education.length > 0,
    }),
  ]);
