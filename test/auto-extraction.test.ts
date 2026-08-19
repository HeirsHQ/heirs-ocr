import { describe, expect, it, vi } from "vitest";
// The pipeline records usage counters and a document-registry row as it runs. Stub
// the pool so those writes cannot open a real connection whose failure resolves
// *after* the test ends — that surfaces as a flaky "Closing rpc while
// onUserConsoleLog was pending" teardown error rather than a test failure.
vi.mock("../src/db", () => ({
  query: async () => ({ rows: [], rowCount: 0 }),
  ensureSchema: async () => {},
  whenDbReady: async () => {},
  closeDb: async () => {},
}));

import { runPipeline, type OcrRequest, type PipelineDeps } from "../src/pipeline";
import { MockLlmClient } from "../src/llm/azure";
import { noopCache } from "../src/cache";
import { defaultProviderPolicy } from "../src/config/providers";
import { logger } from "../src/observability/logger";
import { autoExtraction } from "../src/functions/auto-extraction";
import type { AutoExtractionResult } from "../src/functions/auto-extraction";
import type { DocumentInput, OcrProvider, RecognizedDocument, RecognizeOptions } from "../src/providers/types";

// 1x1 transparent PNG — a real, sniffable image payload (AUTO_EXTRACTION accepts image, not text).
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const doc = (markdown: string): RecognizedDocument => ({
  markdown,
  plainText: markdown,
  pages: [{ page: 1, markdown }],
  blocks: [],
  pageCount: 1,
  provider: "glm-ocr",
  durationMs: 0,
});

const provider = (markdown: string): OcrProvider => ({
  name: "glm-ocr",
  accepts: ["image", "pdf"],
  capabilities: ["text", "layout", "tables", "handwriting", "seals"],
  recognize: async (_i: DocumentInput, _o: RecognizeOptions) => doc(markdown),
});

const deps = (llm: MockLlmClient, markdown: string): PipelineDeps => ({
  llm,
  logger,
  providers: [provider(markdown)],
  cache: noopCache,
  policy: defaultProviderPolicy,
});

const request = (): OcrRequest => ({
  file: { buffer: PNG_1x1, originalName: "upload.png" },
  args: {},
  requestId: "req_test",
  tenantId: "tenant_test",
});

const classification = (label: string, confidence: number) => ({
  label,
  confidence,
  alternatives: [],
  rationale: "test",
});

describe("AUTO_EXTRACTION — identify on upload then route", () => {
  it("routes a Payslip to the template handler and returns its fields", async () => {
    const llm = new MockLlmClient(
      new Map<string, unknown>([
        ["DOCUMENT_CLASSIFICATION_result", classification("Payslip", 0.95)],
        [
          "FORM_DATA_EXTRACTION_result",
          {
            fields: {
              employeeName: "Ada Obi",
              employeeId: "E-100",
              payPeriod: "2026-07",
              basicSalary: 400000,
              allowances: 50000,
              deductions: 20000,
              grossPay: 450000,
              netPay: 430000,
              tax: 15000,
              pension: 5000,
            },
          },
        ],
      ]),
    );

    const { result } = await runPipeline(autoExtraction, request(), deps(llm, "PAYSLIP\nNet Pay: 430000"));
    const data = result as AutoExtractionResult;

    expect(data.documentType).toBe("Payslip");
    expect(data.handler).toBe("template");
    expect((data.data as { fields: Record<string, unknown> }).fields.netPay).toBe(430000);
    // basic+allowances = gross (450000); gross−deductions = net (430000) → reconciles.
    expect(data.validation).toEqual({ confidence: "high", warnings: [] });
  });

  it("downgrades a Payslip to low confidence with a warning when totals don't reconcile", async () => {
    const llm = new MockLlmClient(
      new Map<string, unknown>([
        ["DOCUMENT_CLASSIFICATION_result", classification("Payslip", 0.95)],
        [
          "FORM_DATA_EXTRACTION_result",
          {
            fields: {
              employeeName: "Ada Obi",
              employeeId: "E-100",
              payPeriod: "2026-07",
              basicSalary: 400000,
              allowances: 50000,
              deductions: 20000,
              grossPay: 999999, // ≠ basic + allowances
              netPay: 430000,
              tax: 15000,
              pension: 5000,
            },
          },
        ],
      ]),
    );

    const { result } = await runPipeline(autoExtraction, request(), deps(llm, "PAYSLIP"));
    const data = result as AutoExtractionResult;

    expect(data.validation?.confidence).toBe("low");
    expect(data.validation?.warnings.length).toBeGreaterThan(0);
  });

  it("delegates a CV / Resume to the dedicated resume parser", async () => {
    const resumeResult = {
      contact: {
        name: "Ada Obi",
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
    const llm = new MockLlmClient(
      new Map<string, unknown>([
        ["DOCUMENT_CLASSIFICATION_result", classification("CV / Resume", 0.9)],
        ["RESUME_PARSING_result", resumeResult],
      ]),
    );

    const { result } = await runPipeline(autoExtraction, request(), deps(llm, "Ada Obi — Software Engineer"));
    const data = result as AutoExtractionResult;

    expect(data.documentType).toBe("CV / Resume");
    expect(data.handler).toBe("resume");
    expect((data.data as { contact: { name: string } }).contact.name).toBe("Ada Obi");
  });

  it("reports 'unknown' with no data when classifier confidence is below threshold", async () => {
    // Below minConfidence (default 0.5) → DOCUMENT_CLASSIFICATION collapses to "unknown",
    // and AUTO_EXTRACTION returns without routing rather than guessing.
    const llm = new MockLlmClient(
      new Map<string, unknown>([["DOCUMENT_CLASSIFICATION_result", classification("Payslip", 0.2)]]),
    );

    const { result } = await runPipeline(autoExtraction, request(), deps(llm, "ambiguous scrap of text"));
    const data = result as AutoExtractionResult;

    expect(data.documentType).toBe("unknown");
    expect(data.handler).toBe("none");
    expect(data.data).toBeNull();
  });
});
