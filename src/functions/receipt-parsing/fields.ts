import { z, type ZodType } from "zod";

import { receiptParsingResultSchema, type ReceiptParsingResult } from "./result";

/**
 * Caller-chosen field selection and naming for the receipt result.
 *
 * A `fieldMap` is a *reporting* transform, applied to the finished canonical
 * result — the same rule `lineItemMode` follows (see args.ts). The receipt is
 * always parsed into the canonical shape and reconciled against it, then
 * projected. Asking the model for the caller's names directly would throw away
 * the only independent check this function has: `reconcileTotals` cannot verify
 * `subtotal + tax + tip ≈ total` on fields a caller renamed away or never asked
 * for. So the prompt is byte-identical whether or not a `fieldMap` is supplied.
 */

/** Canonical scalar paths a caller may select, and the type each carries. */
const SCALAR_TYPES: Record<string, ZodType> = {
  "merchant.name": z.string().nullable(),
  "merchant.address": z.string().nullable(),
  "merchant.tin": z.string().nullable(),
  dateTime: z.string().nullable(),
  currency: z.string().nullable(),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  tip: z.number().nullable(),
  total: z.number().nullable(),
  paymentMethod: z.string().nullable(),
};

/** Per-line-item paths, addressed as `lineItems.<key>`. */
const LINE_ITEM_TYPES: Record<string, ZodType> = {
  description: z.string(),
  qty: z.number().nullable(),
  unitPrice: z.number().nullable(),
  total: z.number().nullable(),
};

/**
 * The deterministic reconciliation verdict. Renameable but never droppable: it is
 * the signal that says the arithmetic on this receipt did not add up, and a caller
 * who simply didn't list it would receive a clean-looking payload with no way to
 * tell a checked receipt from a suspect one. It also feeds `confidenceOf` → the
 * low-confidence SLI, which would read `undefined` and score every request 0.
 */
const VERDICT_TYPES: Record<string, ZodType> = {
  confidence: z.enum(["high", "low"]),
  warnings: z.array(z.string()),
};

export const LINE_ITEMS_PATH = "lineItems";
const LINE_ITEM_PREFIX = `${LINE_ITEMS_PATH}.`;

/** Every path accepted in a `fieldMap`, in the order the catalog advertises them. */
export const RECEIPT_FIELD_PATHS: readonly string[] = [
  ...Object.keys(SCALAR_TYPES),
  LINE_ITEMS_PATH,
  ...Object.keys(LINE_ITEM_TYPES).map((k) => `${LINE_ITEM_PREFIX}${k}`),
  ...Object.keys(VERDICT_TYPES),
];

const ALLOWED_PATHS = new Set(RECEIPT_FIELD_PATHS);

/** Output names are identifiers: safe as JSON keys and as generated client fields. */
const OUTPUT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MAX_OUTPUT_NAME_LENGTH = 64;

/**
 * Names that would collide with object internals downstream. `Object.fromEntries`
 * defines own properties so it is not itself exploitable, but a `__proto__` key
 * still breaks naive consumers, so it is refused at the edge.
 */
const RESERVED_NAMES = new Set(["__proto__", "constructor", "prototype"]);

const outputNameSchema = z
  .string()
  .min(1)
  .max(MAX_OUTPUT_NAME_LENGTH)
  .regex(OUTPUT_NAME_PATTERN, "Field names must start with a letter or underscore and contain only [A-Za-z0-9_]");

/**
 * `{ canonical path → caller's name }`. Keys select, values rename.
 *
 * String-keyed rather than `z.record(z.enum(paths), …)`: in Zod 4 an enum-keyed
 * record demands *every* member be present, which would reject any partial
 * selection — the whole point of the field map.
 */
export const receiptFieldMapSchema = z.record(z.string(), outputNameSchema).superRefine((map, ctx) => {
  const entries = Object.entries(map);
  if (entries.length === 0) {
    ctx.addIssue({ code: "custom", message: "fieldMap must select at least one field" });
  }

  for (const [path, name] of entries) {
    if (!ALLOWED_PATHS.has(path)) {
      ctx.addIssue({
        code: "custom",
        path: [path],
        message: `Unknown receipt field '${path}'. Valid fields: ${RECEIPT_FIELD_PATHS.join(", ")}`,
      });
    }
    if (RESERVED_NAMES.has(name)) {
      ctx.addIssue({ code: "custom", path: [path], message: `'${name}' is a reserved field name` });
    }
  }

  // Two canonical fields mapped onto one output name would silently drop one of
  // them, so it is refused rather than resolved by insertion order.
  const byName = new Map<string, string[]>();
  for (const [path, name] of entries) byName.set(name, [...(byName.get(name) ?? []), path]);
  for (const [name, paths] of byName) {
    if (paths.length > 1) {
      ctx.addIssue({ code: "custom", message: `Duplicate output name '${name}' for fields ${paths.join(", ")}` });
    }
  }
});

export type ReceiptFieldMap = z.infer<typeof receiptFieldMapSchema>;

/** A receipt reported under the caller's own field names. */
export type ProjectedReceipt = Record<string, unknown>;

/** The canonical result, or a caller-projected one when `fieldMap` is supplied. */
export type ReceiptParsingOutput = ReceiptParsingResult | ProjectedReceipt;

const lineItemSubPaths = (fieldMap: ReceiptFieldMap): Array<[string, string]> =>
  Object.entries(fieldMap)
    .filter(([path]) => path.startsWith(LINE_ITEM_PREFIX))
    .map(([path, name]) => [path.slice(LINE_ITEM_PREFIX.length), name]);

/** Reads a canonical scalar path (`merchant.name` or a top-level key) off the result. */
const scalarAt = (result: ReceiptParsingResult, path: string): unknown => {
  const [head, tail] = path.split(".");
  const root = result as unknown as Record<string, unknown>;
  if (tail === undefined) return root[head!];
  return (root[head!] as Record<string, unknown> | null)?.[tail];
};

/** The output key the reconciliation verdict is reported under. */
export const verdictKey = (fieldMap: ReceiptFieldMap | undefined, field: "confidence" | "warnings"): string =>
  fieldMap?.[field] ?? field;

/**
 * Projects a reconciled receipt onto the caller's field map.
 *
 * Line items follow the array: mapping `lineItems` renames the array itself and
 * keeps canonical item keys, while mapping `lineItems.<key>` selects and renames
 * within each item. Using either form emits the array; the array's own name
 * defaults to `lineItems` when only sub-fields are mapped.
 */
export const projectReceipt = (result: ReceiptParsingResult, fieldMap: ReceiptFieldMap): ProjectedReceipt => {
  const entries: Array<[string, unknown]> = [];

  for (const [path, name] of Object.entries(fieldMap)) {
    if (path === LINE_ITEMS_PATH || path.startsWith(LINE_ITEM_PREFIX) || path in VERDICT_TYPES) continue;
    entries.push([name, scalarAt(result, path)]);
  }

  const subs = lineItemSubPaths(fieldMap);
  const arrayName = fieldMap[LINE_ITEMS_PATH];
  if (arrayName !== undefined || subs.length > 0) {
    const items = result.lineItems.map((item) => {
      if (subs.length === 0) return { ...item };
      const record = item as unknown as Record<string, unknown>;
      return Object.fromEntries(subs.map(([sub, name]) => [name, record[sub]]));
    });
    entries.push([arrayName ?? LINE_ITEMS_PATH, items]);
  }

  // Always emitted — see VERDICT_TYPES.
  entries.push([verdictKey(fieldMap, "confidence"), result.confidence]);
  entries.push([verdictKey(fieldMap, "warnings"), result.warnings]);

  return Object.fromEntries(entries);
};

/**
 * The result schema for a request: canonical when no `fieldMap` is given, else an
 * object mirroring exactly what {@link projectReceipt} emits — so the pipeline's
 * generic validation step still checks the payload the caller actually receives.
 */
export const buildReceiptResultSchema = (fieldMap: ReceiptFieldMap | undefined): ZodType<ReceiptParsingOutput> => {
  if (!fieldMap) return receiptParsingResultSchema as ZodType<ReceiptParsingOutput>;

  const shape: Record<string, ZodType> = {};

  for (const [path, name] of Object.entries(fieldMap)) {
    if (path === LINE_ITEMS_PATH || path.startsWith(LINE_ITEM_PREFIX) || path in VERDICT_TYPES) continue;
    shape[name] = SCALAR_TYPES[path]!;
  }

  const subs = lineItemSubPaths(fieldMap);
  const arrayName = fieldMap[LINE_ITEMS_PATH];
  if (arrayName !== undefined || subs.length > 0) {
    const itemShape =
      subs.length === 0
        ? LINE_ITEM_TYPES
        : Object.fromEntries(subs.map(([sub, name]) => [name, LINE_ITEM_TYPES[sub]!]));
    shape[arrayName ?? LINE_ITEMS_PATH] = z.array(z.object(itemShape));
  }

  shape[verdictKey(fieldMap, "confidence")] = VERDICT_TYPES.confidence!;
  shape[verdictKey(fieldMap, "warnings")] = VERDICT_TYPES.warnings!;

  return z.object(shape) as unknown as ZodType<ReceiptParsingOutput>;
};
