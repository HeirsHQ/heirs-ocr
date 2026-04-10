export function buildSigningPrompt(
  ocrText: string,
  signerName: string,
  comparisonData?: { name: string; date?: string },
) {
  const system = `You are a document analysis assistant. Analyze the provided document text and extract signing/signature information.
Return ONLY valid JSON with this exact structure (no explanation, no markdown):
{
  "signatureDetected": boolean,
  "signatureConfidence": number,
  "signerNameFound": boolean,
  "dateFound": boolean,
  "extractedSignerName": string | null,
  "extractedDate": string | null
}
- signatureDetected: true if there are indicators the document has been signed (signature lines, "signed by", handwritten marks, etc.)
- signatureConfidence: 0.0 to 1.0
- signerNameFound: true if the name "${signerName}" appears in the document
- extractedSignerName: the actual signer name found, or null
- extractedDate: the signing date found (preserve original format), or null`;

  let user = `Analyze this document for signature information. The expected signer name is "${signerName}".\n\n--- DOCUMENT TEXT ---\n${ocrText}\n--- END ---`;
  if (comparisonData) {
    user += `\n\nCompare against: name="${comparisonData.name}"${comparisonData.date ? `, date="${comparisonData.date}"` : ""}`;
  }
  return { system, user };
}

export function buildIdVerificationPrompt(
  ocrText: string,
  documentType: string,
  comparisonData?: { fullName: string; dateOfBirth?: string; idNumber?: string },
) {
  const hasComparison = !!comparisonData;

  const system = `You are an identity document analysis assistant. Extract personal information from the provided ${documentType} document text.
Return ONLY valid JSON with this exact structure (no explanation, no markdown):
{
  "extractedName": string | null,
  "extractedDateOfBirth": string | null,
  "extractedIdNumber": string | null,
  "extractedDocumentType": string | null${
    hasComparison
      ? `,
  "comparisonResult": {
    "nameMatch": boolean,
    "dobMatch": boolean,
    "idNumberMatch": boolean,
    "overallMatch": boolean
  }`
      : ""
  }
}
- extractedName: the full name found on the document
- extractedDateOfBirth: date of birth in the format found on the document
- extractedIdNumber: the ID/passport/license number
- extractedDocumentType: the detected document type (national_id, passport, or drivers_license)${
    hasComparison
      ? `
- comparisonResult: compare the extracted values against the provided comparison data. Use semantic matching — names match if they refer to the same person (ignore case, spacing, ordering of first/last name). Dates match if they represent the same date regardless of format (e.g. "15/03/1990" matches "1990-03-15" or "March 15, 1990"). ID numbers match if they are the same ignoring case and whitespace. overallMatch is true only if ALL provided comparison fields match.`
      : ""
  }
Extract values even if they are partially obscured or in unusual formats. Search the ENTIRE text thoroughly. Return null only if a field is truly not present.`;

  let user = `Extract identity information from this ${documentType} document:\n\n--- DOCUMENT TEXT ---\n${ocrText}\n--- END ---`;
  if (comparisonData) {
    user += `\n\nCompare extracted data against:\n- Full Name: "${comparisonData.fullName}"`;
    if (comparisonData.dateOfBirth) user += `\n- Date of Birth: "${comparisonData.dateOfBirth}"`;
    if (comparisonData.idNumber) user += `\n- ID Number: "${comparisonData.idNumber}"`;
  }
  return { system, user };
}

export function buildDocumentClassificationPrompt(ocrText: string) {
  const system = `You are a document classification assistant. Classify the document into one of these categories:
- letter_of_recommendation
- code_of_conduct
- photo_media_consent
- disclaimer_indemnity

Return ONLY valid JSON with this exact structure (no explanation, no markdown):
{
  "detectedType": string | null,
  "confidence": number,
  "matchedKeywords": string[]
}
- detectedType: one of the categories above, or null if it doesn't match any
- confidence: 0.0 to 1.0
- matchedKeywords: key phrases from the text that led to the classification`;

  const user = `Classify this document:\n\n--- DOCUMENT TEXT ---\n${ocrText}\n--- END ---`;
  return { system, user };
}

export function buildFormDataExtractionPrompt(ocrText: string, targetFields?: string[]) {
  const fieldInstruction =
    targetFields && targetFields.length > 0
      ? `Focus on extracting these specific fields: ${targetFields.join(", ")}.`
      : "Extract all key-value pairs you can identify in the form.";

  const system = `You are a form data extraction assistant. Extract key-value pairs from the document text.
${fieldInstruction}
Return ONLY valid JSON with this exact structure (no explanation, no markdown):
{
  "fields": { "fieldName": "fieldValue", ... }
}
Use the field labels as they appear in the form as keys. Use the corresponding filled-in values as values.`;

  const user = `Extract form fields from this document:\n\n--- DOCUMENT TEXT ---\n${ocrText}\n--- END ---`;
  return { system, user };
}

export function buildReceiptParsingPrompt(ocrText: string, preferredCurrency?: string) {
  const currencyInstruction = preferredCurrency
    ? `The expected currency is ${preferredCurrency}.`
    : "Detect the currency from the receipt if possible.";

  const system = `You are a receipt parsing assistant. Extract structured data from the receipt text.
${currencyInstruction}
Return ONLY valid JSON with this exact structure (no explanation, no markdown):
{
  "vendor": string | null,
  "date": string | null,
  "totalAmount": string | null,
  "currency": string | null,
  "lineItems": [{ "description": string, "amount": string }],
  "taxAmount": string | null
}
- vendor: business/store name
- date: transaction date (preserve original format)
- totalAmount: total amount as a string (e.g. "25,000.00")
- currency: 3-letter currency code (e.g. "NGN", "USD")
- lineItems: individual items with description and amount
- taxAmount: tax/VAT amount if present`;

  const user = `Parse this receipt:\n\n--- RECEIPT TEXT ---\n${ocrText}\n--- END ---`;
  return { system, user };
}

export function buildTextExtraction(ocrText: string, language = "eng") {
  const system = `You are a text extraction assistant. Extract all readable text from the provided document.
Return ONLY valid JSON with this exact structure (no explanation, no markdown):
{
  "extractedText": string
}
- extractedText: the full readable text content from the document, preserving layout and structure as much as possible`;

  const user = `Extract all text from this document (${language}):\n\n--- DOCUMENT TEXT ---\n${ocrText}\n--- END ---`;
  return { system, user };
}
