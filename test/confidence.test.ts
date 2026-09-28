import { describe, expect, it, vi } from "vitest";
// Pipeline runs record usage + a document row; stub the pool so no real connection
// outlives the test (see the note in receipt-parsing.test.ts).
vi.mock("../src/db", () => ({
  query: async () => ({ rows: [], rowCount: 0 }),
  ensureSchema: async () => {},
  whenDbReady: async () => {},
  closeDb: async () => {},
}));

import { PNG_1x1, deps, fakeProvider, makeDoc, mockLlm, request, runPipeline } from "./support";
import { completeness, scoreFrom, withExtraction } from "../src/functions/confidence";
import { documentClassification } from "../src/functions/document-classification";
import { documentAuthenticity } from "../src/functions/document-authenticity";
import { bankStatementAnalysis } from "../src/functions/bank-statement-analysis";
import { formDataExtraction } from "../src/functions/form-data-extraction";
import { autoExtraction, AutoDocumentType } from "../src/functions/auto-extraction";
import { idVerification } from "../src/functions/id-verification";
import { textExtraction } from "../src/functions/text-extraction";
import { resumeParsing } from "../src/functions/resume-parsing";
import { budgetAnalysis } from "../src/functions/budget-analysis";
import { expenseClaim } from "../src/functions/expense-claim";
import { listFunctions } from "../src/functions/registry";
import { loanReview } from "../src/functions/loan-review";
import { signing } from "../src/functions/signing";

describe("confidence primitives", () => {
  it("multiplies deductions and keeps a reason for each", () => {
    expect(scoreFrom([null, { factor: 0.5, reason: "a" }, { factor: 0.9, reason: "b" }])).toEqual({
      score: 0.45,
      reasons: ["a", "b"],
    });
  });

  it("floors so a score never rounds up across the review threshold", () => {
    expect(scoreFrom([{ factor: 0.9499, reason: "x" }]).score).toBe(0.949);
    expect(scoreFrom([{ factor: 19 / 20, reason: "x" }]).score).toBe(0.95);
  });

  it("scores key-field fill rate and names what is missing", () => {
    expect(completeness({ a: true, b: true })).toBeNull();
    expect(completeness({ a: true, b: false, c: false, d: true })).toEqual({
      factor: 0.5,
      reason: "Not found on the document: b, c.",
    });
  });

  it("treats a provider without an OCR signal as neutral and applies one that has it", () => {
    const clean = { score: 1, reasons: [] };
    expect(withExtraction(makeDoc("x"), clean)).toEqual(clean);
    expect(withExtraction(makeDoc("x", { ocrConfidence: 0.9, provider: "tesseract" }), clean)).toEqual({
      score: 0.9,
      reasons: ["OCR read the text at 90.0% character confidence (tesseract)."],
    });
  });
});

describe("every function scores its result", () => {
  it("declares confidenceOf on all thirteen definitions", () => {
    const defs = listFunctions();
    expect(defs).toHaveLength(13);
    for (const def of defs) expect(typeof def.confidenceOf, def.key).toBe("function");
  });
});

describe("pipeline review flag", () => {
  const classify = (confidence: number, over = {}) =>
    runPipeline(
      documentClassification,
      request(PNG_1x1, { allowUnknown: false }, "x.png"),
      deps({
        llm: mockLlm([
          ["DOCUMENT_CLASSIFICATION_result", { label: "invoice", confidence, alternatives: [], rationale: "r" }],
        ]),
        providers: [fakeProvider("INVOICE", over)],
      }),
    );

  it("passes a result at exactly the 0.95 bar", async () => {
    const { meta } = await classify(0.95);
    expect(meta).toMatchObject({ confidence: 0.95, needsReview: false });
  });

  it("flags a result just under the bar, with the reason", async () => {
    const { meta } = await classify(0.94);
    expect(meta.needsReview).toBe(true);
    expect(meta.reviewReasons).toEqual(["Classified as 'invoice' at 94.0%."]);
  });

  it("folds the provider's OCR confidence into an otherwise clean result", async () => {
    const { meta } = await classify(1, { ocrConfidence: 0.8, provider: "glm-ocr" });
    expect(meta.confidence).toBe(0.8);
    expect(meta.needsReview).toBe(true);
    expect(meta.reviewReasons[0]).toMatch(/80\.0% character confidence/);
  });

  it("scores exact text-layer extraction at 1", async () => {
    const { meta } = await runPipeline(textExtraction, request(Buffer.from("hello world"), {}, "a.txt"), deps());
    expect(meta).toMatchObject({ confidence: 1, needsReview: false, reviewReasons: [] });
  });
});

describe("per-function evidence", () => {
  it("TEXT_EXTRACTION: nothing read scores 0", () => {
    expect(textExtraction.confidenceOf({ text: "  ", format: "markdown", pageCount: 1 }, {} as never).score).toBe(0);
  });

  it("DOCUMENT_CLASSIFICATION: 'unknown' scores 0", () => {
    const r = { label: "unknown", confidence: 0.99, alternatives: [], rationale: "" };
    expect(documentClassification.confidenceOf(r, {} as never).score).toBe(0);
  });

  it("RESUME_PARSING: missing contact route and history", () => {
    const r = {
      contact: {
        name: "Ada",
        email: null,
        phone: null,
        location: null,
        address: null,
        state: null,
        country: null,
        zip: null,
        nationality: null,
        links: [],
      },
      summary: null,
      experience: [],
      education: [],
      certifications: [],
      professionalBodies: [],
      languages: [],
      skills: [],
    };
    const a = resumeParsing.confidenceOf(r, {} as never);
    expect(a.score).toBe(0.333);
    expect(a.reasons).toEqual(["Not found on the document: email or phone, experience or education."]);
  });

  const idResult = (checks: Record<string, boolean | null> = {}) => ({
    documentType: "PASSPORT" as const,
    fields: {
      fullName: "ADA OBI",
      surname: "OBI",
      firstName: "ADA",
      middleName: null,
      dateOfBirth: "1990-01-01",
      documentNumber: "A123",
      issueDate: null,
      expiryDate: "2020-01-01",
      nationality: null,
      sex: null,
      placeOfBirth: null,
      address: null,
      licenceCategory: null,
      issuingAuthority: null,
    },
    checks: {
      expired: true,
      expiryDate: "2020-01-01",
      nameMatch: null,
      dobMatch: null,
      numberMatch: null,
      mrzValid: true,
      ...checks,
    },
    assuranceLevel: "document-content-only" as const,
  });

  it("ID_VERIFICATION: expiry is not doubt, but a failed MRZ checksum or mismatch is", () => {
    expect(idVerification.confidenceOf(idResult(), {} as never).score).toBe(1);
    const a = idVerification.confidenceOf(idResult({ mrzValid: false, nameMatch: false }), {} as never);
    expect(a.score).toBe(0.25);
    expect(a.reasons).toHaveLength(2);
  });

  it("FORM_DATA_EXTRACTION: fill rate over requested fields, for both arg shapes", () => {
    const fields = [
      { name: "a", type: "string" as const, required: true },
      { name: "b", type: "string" as const, required: false },
    ];
    expect(formDataExtraction.confidenceOf({ fields: { a: "x", b: null } }, { fields }).score).toBe(0.5);
    const jsonSchema = { type: "object", properties: { a: { type: "string" }, b: { type: "number" } } };
    expect(formDataExtraction.confidenceOf({ fields: { a: "x", b: 3 } }, { jsonSchema }).score).toBe(1);
    expect(formDataExtraction.confidenceOf({ fields: { a: "" } }, { jsonSchema }).score).toBe(0);
  });

  it("DOCUMENT_AUTHENTICITY: 1 − suspicion score; inconclusive scores 0", () => {
    const base = { assuranceLevel: "heuristic-only" as const, analyzer: "pdf" as const };
    expect(documentAuthenticity.confidenceOf({ ...base, verdict: "clean", score: 0, signals: [] }, {}).score).toBe(1);
    const suspicious = documentAuthenticity.confidenceOf(
      {
        ...base,
        verdict: "suspicious",
        score: 0.4,
        signals: [{ code: "PDF_MULTIPLE_REVISIONS", severity: "medium", detail: "edited after save" }],
      },
      {},
    );
    expect(suspicious.score).toBe(0.6);
    expect(suspicious.reasons).toContain("PDF_MULTIPLE_REVISIONS: edited after save");
    expect(
      documentAuthenticity.confidenceOf(
        { ...base, analyzer: "unsupported", verdict: "inconclusive", score: 0, signals: [] },
        {},
      ).score,
    ).toBe(0);
  });

  it("SIGNING: a precise run that located nothing still needs a look", () => {
    const r = { fullyExecuted: false, blocks: [], unsignedBlocks: [], confidence: "high" as const, warnings: [] };
    expect(signing.confidenceOf(r, {} as never).score).toBe(0.5);
  });

  it("BUDGET_ANALYSIS: nothing to reconcile is not a clean reconcile", () => {
    const r = {
      title: null,
      period: null,
      currency: "NGN",
      lineItems: [],
      totals: { planned: null, actual: null, variance: null },
      confidence: "high" as const,
      warnings: [],
    };
    expect(budgetAnalysis.confidenceOf(r, {} as never).score).toBe(0);
  });

  it("EXPENSE_CLAIM: a missing-receipt warning alone routes to review", () => {
    const r = {
      claimant: { name: "Ada", employeeId: null, department: null },
      title: null,
      dateSubmitted: null,
      currency: "NGN",
      lineItems: [{ date: null, category: null, description: null, amount: 100, receiptAttached: false }],
      subtotal: 100,
      tax: null,
      total: 100,
      confidence: "high" as const,
      warnings: ["1 line item(s) have no attached receipt."],
    };
    const a = expenseClaim.confidenceOf(r, {} as never);
    expect(a.score).toBe(0.9);
  });

  it("BANK_STATEMENT_ANALYSIS and LOAN_REVIEW: a 'low' verdict halves, each warning costs 10%", () => {
    const bank = bankStatementAnalysis.confidenceOf(
      {
        accountHolder: null,
        accountNumber: "0123",
        bank: null,
        period: { start: null, end: null },
        openingBalance: null,
        closingBalance: null,
        currency: "NGN",
        transactions: [{ date: null, description: null, debit: 1, credit: null, balance: null }],
        summary: { totalCredits: 0, totalDebits: 1, netFlow: -1, transactionCount: 1 },
        confidence: "low",
        warnings: ["Opening or closing balance missing — could not reconcile the statement."],
      },
      {} as never,
    );
    expect(bank.score).toBe(0.45);

    const loan = loanReview.confidenceOf(
      {
        borrower: { name: "Ada", dateOfBirth: null, bvn: null, employmentStatus: null, employer: null },
        requestedAmount: 1000,
        currency: "NGN",
        tenorMonths: 12,
        income: { monthly: 500 },
        obligations: { monthlyDebt: 0 },
        riskFlags: [],
        summary: "",
        affordability: { debtToIncome: 0, disposableIncome: 500 },
        recommendation: "approve",
        confidence: "high",
        warnings: [],
      },
      {} as never,
    );
    expect(loan).toEqual({ score: 1, reasons: [] });
  });

  it("AUTO_EXTRACTION: routing × the routed parser; unrouted scores 0", () => {
    const summary = { confidence: 0.9, alternatives: [], rationale: "" };
    expect(
      autoExtraction.confidenceOf(
        { documentType: "unknown", handler: "none", classification: summary, data: null, validation: null },
        {} as never,
      ).score,
    ).toBe(0);

    const payslip = autoExtraction.confidenceOf(
      {
        documentType: AutoDocumentType.PAYSLIP,
        handler: "template",
        classification: { ...summary, confidence: 1 },
        data: { fields: {} },
        validation: { confidence: "high", warnings: [] },
      },
      {} as never,
    );
    // No payslip field was found.
    expect(payslip.score).toBe(0);
    expect(payslip.reasons[0]).toMatch(/^Not found on the document: /);
  });
});
