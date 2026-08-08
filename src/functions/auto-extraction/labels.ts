import type { FieldSpec } from "../form-data-extraction/args";

/**
 * The catalog of document types this service identifies on upload, transcribed
 * verbatim from the PM's "Document Parsing Parameters" spec. The string values
 * are the labels fed to DOCUMENT_CLASSIFICATION as `candidateLabels`, so they
 * must read naturally to the classifier — keep them human, not code-y.
 */
export const AutoDocumentType = {
  RESUME: "CV / Resume",
  ID_PASSPORT: "National ID / Passport",
  DRIVERS_LICENCE: "Driver's Licence",
  EDUCATIONAL_CERTIFICATE: "Educational Certificate",
  PROFESSIONAL_CERTIFICATE: "Professional Certificate",
  OFFER_LETTER: "Employment / Offer Letter",
  PREVIOUS_EMPLOYMENT_LETTER: "Previous Employment Letter",
  REFERENCE_LETTER: "Reference Letter",
  MEDICAL_DOCUMENT: "Medical / Health Document",
  BANK_DOCUMENT: "Bank Document",
  TAX_DOCUMENT: "Tax Document",
  PROOF_OF_ADDRESS: "Proof of Address",
  PAYSLIP: "Payslip",
  EMPLOYMENT_CONTRACT: "Employment Contract",
  TRAINING_CERTIFICATE: "Training Certificate",
  RECEIPT: "Receipts",
} as const;

export type AutoDocumentLabel = (typeof AutoDocumentType)[keyof typeof AutoDocumentType];

/** All 16 labels — the classifier's candidate set. */
export const DOCUMENT_LABELS = Object.values(AutoDocumentType) as [AutoDocumentLabel, ...AutoDocumentLabel[]];

/**
 * How a detected type is fulfilled:
 *  - `resume` / `id` / `receipt` delegate to the dedicated parsers (richer,
 *    with their own validation — MRZ checks, totals reconciliation, nested shape).
 *  - `template` runs FORM_DATA_EXTRACTION against a fixed field spec below.
 */
export type Handler =
  | { kind: "resume" }
  | { kind: "id" }
  | { kind: "receipt" }
  | { kind: "template"; fields: readonly FieldSpec[] };

/** Shorthand for a template field. `required` defaults to false via the FieldSpec schema. */
const f = (name: string, type: FieldSpec["type"], description: string): FieldSpec => ({
  name,
  type,
  description,
  required: false,
});

/**
 * Field specs for the 12 template-driven types. Field order and wording follow
 * the spec's "Data That Can Be Extracted" column; `date` fields are asked for as
 * ISO 8601, numbers where the value is monetary/quantitative.
 */
const TEMPLATES: Partial<Record<AutoDocumentLabel, readonly FieldSpec[]>> = {
  [AutoDocumentType.EDUCATIONAL_CERTIFICATE]: [
    f("name", "string", "Full name of the holder"),
    f("institution", "string", "Awarding institution"),
    f("qualification", "string", "Qualification or degree"),
    f("fieldOfStudy", "string", "Course or field of study"),
    f("classOrGrade", "string", "Class or grade"),
    f("graduationDate", "date", "Graduation date"),
    f("certificateNumber", "string", "Certificate number"),
    f("issuingAuthority", "string", "Issuing authority"),
  ],
  [AutoDocumentType.PROFESSIONAL_CERTIFICATE]: [
    f("employeeName", "string", "Name of the certified person"),
    f("certificationName", "string", "Certification name"),
    f("certificationBody", "string", "Certification body"),
    f("certificateNumber", "string", "Certificate number"),
    f("issueDate", "date", "Issue date"),
    f("expiryDate", "date", "Expiry date"),
    f("levelOrGrade", "string", "Level or grade"),
  ],
  [AutoDocumentType.OFFER_LETTER]: [
    f("employeeName", "string", "Employee name"),
    f("jobTitle", "string", "Job title"),
    f("department", "string", "Department"),
    f("company", "string", "Company"),
    f("employmentType", "string", "Employment type"),
    f("startDate", "date", "Start date"),
    f("salary", "string", "Salary (as written, including currency)"),
    f("reportingManager", "string", "Reporting manager"),
    f("workLocation", "string", "Work location"),
    f("grade", "string", "Grade"),
  ],
  [AutoDocumentType.PREVIOUS_EMPLOYMENT_LETTER]: [
    f("employeeName", "string", "Employee name"),
    f("previousEmployer", "string", "Previous employer"),
    f("jobTitle", "string", "Job title"),
    f("employmentStartDate", "date", "Employment start date"),
    f("employmentEndDate", "date", "Employment end date"),
    f("reasonForExit", "string", "Reason for exit"),
    f("lastPosition", "string", "Last position held"),
  ],
  [AutoDocumentType.REFERENCE_LETTER]: [
    f("employeeName", "string", "Employee name"),
    f("refereeName", "string", "Referee name"),
    f("refereeOrganisation", "string", "Referee organisation"),
    f("relationship", "string", "Relationship to the employee"),
    f("position", "string", "Position held"),
    f("employmentPeriod", "string", "Employment period"),
    f("comments", "string", "Referee comments"),
  ],
  [AutoDocumentType.MEDICAL_DOCUMENT]: [
    f("employeeName", "string", "Employee name"),
    f("documentType", "string", "Document type"),
    f("issueDate", "date", "Issue date"),
    f("expiryDate", "date", "Expiry date"),
    f("issuingOrganisation", "string", "Issuing organisation"),
  ],
  [AutoDocumentType.BANK_DOCUMENT]: [
    f("employeeName", "string", "Employee name"),
    f("bankName", "string", "Bank name"),
    f("accountName", "string", "Account name"),
    f("accountNumber", "string", "Account number"),
    f("sortOrBankCode", "string", "Sort code or bank code"),
    f("branch", "string", "Branch"),
  ],
  [AutoDocumentType.TAX_DOCUMENT]: [
    f("employeeName", "string", "Employee name"),
    f("taxId", "string", "Tax ID or TIN"),
    f("taxAuthority", "string", "Tax authority"),
    f("taxRegistrationDate", "date", "Tax registration date"),
    f("taxStatus", "string", "Tax status"),
  ],
  [AutoDocumentType.PROOF_OF_ADDRESS]: [
    f("employeeName", "string", "Employee name"),
    f("residentialAddress", "string", "Residential address"),
    f("city", "string", "City"),
    f("stateOrProvince", "string", "State or province"),
    f("country", "string", "Country"),
    f("documentDate", "date", "Document date"),
    f("issuingOrganisation", "string", "Issuing organisation"),
  ],
  [AutoDocumentType.PAYSLIP]: [
    f("employeeName", "string", "Employee name"),
    f("employeeId", "string", "Employee ID"),
    f("payPeriod", "string", "Pay period"),
    f("basicSalary", "number", "Basic salary"),
    f("allowances", "number", "Allowances"),
    f("deductions", "number", "Deductions"),
    f("grossPay", "number", "Gross pay"),
    f("netPay", "number", "Net pay"),
    f("tax", "number", "Tax"),
    f("pension", "number", "Pension"),
  ],
  [AutoDocumentType.EMPLOYMENT_CONTRACT]: [
    f("employeeName", "string", "Employee name"),
    f("jobTitle", "string", "Job title"),
    f("department", "string", "Department"),
    f("employmentType", "string", "Employment type"),
    f("startDate", "date", "Start date"),
    f("endDate", "date", "End date"),
    f("salary", "string", "Salary (as written, including currency)"),
    f("benefits", "string", "Benefits"),
    f("workLocation", "string", "Work location"),
    f("reportingManager", "string", "Reporting manager"),
  ],
  [AutoDocumentType.TRAINING_CERTIFICATE]: [
    f("employeeName", "string", "Employee name"),
    f("trainingName", "string", "Course or training name"),
    f("trainingProvider", "string", "Training provider"),
    f("completionDate", "date", "Completion date"),
    f("expiryDate", "date", "Expiry date"),
    f("certificateNumber", "string", "Certificate number"),
  ],
};

/** Label → handler. The four non-template types delegate to dedicated parsers. */
export const HANDLERS: Record<AutoDocumentLabel, Handler> = {
  ...(Object.fromEntries(
    Object.entries(TEMPLATES).map(([label, fields]) => [label, { kind: "template", fields }]),
  ) as Record<AutoDocumentLabel, Handler>),
  [AutoDocumentType.RESUME]: { kind: "resume" },
  [AutoDocumentType.ID_PASSPORT]: { kind: "id" },
  [AutoDocumentType.DRIVERS_LICENCE]: { kind: "id" },
  [AutoDocumentType.RECEIPT]: { kind: "receipt" },
};

/**
 * Resolves a classifier-returned label to a canonical one. Exact match first,
 * then a case-insensitive fallback; anything else is treated as unknown so we
 * never route on a label we can't map.
 */
export const resolveLabel = (label: string): AutoDocumentLabel | null => {
  if ((DOCUMENT_LABELS as readonly string[]).includes(label)) return label as AutoDocumentLabel;
  const lower = label.toLowerCase().trim();
  return DOCUMENT_LABELS.find((l) => l.toLowerCase() === lower) ?? null;
};
