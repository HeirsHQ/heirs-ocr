import { OcrFunction, resolveResultSchema, type OcrFunctionDefinition, type OcrFunctionKey } from "./define";
import { documentClassification } from "./document-classification";
import { bankStatementAnalysis } from "./bank-statement-analysis";
import { documentAuthenticity } from "./document-authenticity";
import { formDataExtraction } from "./form-data-extraction";
import { autoExtraction } from "./auto-extraction";
import { budgetAnalysis } from "./budget-analysis";
import { idVerification } from "./id-verification";
import { receiptParsing } from "./receipt-parsing";
import { textExtraction } from "./text-extraction";
import { resumeParsing } from "./resume-parsing";
import type { JsonSchema } from "../llm/schema";
import { expenseClaim } from "./expense-claim";
import { toJsonSchema } from "../llm/schema";
import { loanReview } from "./loan-review";
import { signing } from "./signing";

/** Heterogeneous arg/result types across the catalog; the registry is keyed by function. */
export type AnyOcrFunctionDefinition = OcrFunctionDefinition<any, any>;

const definitions: AnyOcrFunctionDefinition[] = [
  textExtraction,
  documentClassification,
  receiptParsing,
  formDataExtraction,
  resumeParsing,
  idVerification,
  signing,
  documentAuthenticity,
  autoExtraction,
  budgetAnalysis,
  expenseClaim,
  loanReview,
  bankStatementAnalysis,
];

const registry = new Map<OcrFunctionKey, AnyOcrFunctionDefinition>(definitions.map((d) => [d.key, d]));

export const getFunction = (key: string): AnyOcrFunctionDefinition | undefined => registry.get(key as OcrFunctionKey);

export const isOcrFunctionKey = (key: string): key is OcrFunctionKey =>
  Object.prototype.hasOwnProperty.call(OcrFunction, key);

export const listFunctions = (): AnyOcrFunctionDefinition[] => [...registry.values()];

/** Catalog entry for `GET /v1/ocr/functions` — JSON Schemas let callers generate forms + validate client-side. */
export type CatalogEntry = {
  key: OcrFunctionKey;
  description: string;
  accepts: readonly string[];
  requires: readonly string[];
  sensitivity: string;
  /** Capabilities that improve the result but are not needed to produce one. */
  prefers?: readonly string[];
  maxPages: number;
  argsSchema: JsonSchema;
  /** Absent for dynamic-schema functions whose result shape depends on args. */
  resultSchema?: JsonSchema;
};

/** Walks the registry and returns the JSON-Schema catalog. */
export const buildCatalog = (): CatalogEntry[] =>
  listFunctions().map((def) => ({
    key: def.key,
    description: def.description,
    accepts: def.accepts,
    requires: def.requires,
    prefers: def.prefers,
    sensitivity: def.sensitivity,
    maxPages: def.maxPages,
    argsSchema: toJsonSchema(def.argsSchema, `${def.key}_args`),
    resultSchema: catalogResultSchema(def),
  }));

/**
 * The result shape to publish for a function.
 *
 * A dynamic schema is resolved against the function's *default* args, so a
 * function whose args are all optional (RECEIPT_PARSING, where `fieldMap` merely
 * renames the canonical shape) still advertises something callers can generate
 * forms from. Only a function with no shape at all until the caller supplies one
 * — FORM_DATA_EXTRACTION, whose args are a required union — publishes none.
 *
 * Without this, giving a function a dynamic schema silently removed its entry from
 * the catalog, which is a breaking change for any client reading it.
 */
const catalogResultSchema = (def: AnyOcrFunctionDefinition): JsonSchema | undefined => {
  if (typeof def.resultSchema !== "function") return toJsonSchema(def.resultSchema, `${def.key}_result`);

  const defaults = def.argsSchema.safeParse({});
  if (!defaults.success) return undefined;
  return toJsonSchema(resolveResultSchema(def, defaults.data), `${def.key}_result`);
};
