import { completeness, isPresent, scoreFrom, type ConfidenceAssessment } from "../confidence";
import type { FormDataExtractionResult } from "./result";
import type { FormDataExtractionArgs } from "./args";

/**
 * Fill rate over the fields the caller asked for. Optional fields count too: the
 * caller listed them, and "blank on the form" and "missed by OCR" look identical here.
 */
export const assessFormDataExtraction = (
  result: FormDataExtractionResult,
  args: FormDataExtractionArgs,
): ConfidenceAssessment => {
  const names = "fields" in args ? args.fields.map((f) => f.name) : declaredProperties(args.jsonSchema, result);
  return scoreFrom([completeness(Object.fromEntries(names.map((name) => [name, isPresent(result.fields[name])])))]);
};

/** Top-level properties a raw JSON Schema declares, else whatever keys came back. */
const declaredProperties = (jsonSchema: Record<string, unknown>, result: FormDataExtractionResult): string[] => {
  const properties = jsonSchema.properties;
  return properties && typeof properties === "object" ? Object.keys(properties) : Object.keys(result.fields);
};
