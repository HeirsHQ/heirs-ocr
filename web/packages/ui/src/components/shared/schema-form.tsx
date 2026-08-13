"use client";

import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { cn } from "../../lib/utils";

/** Minimal view of the JSON Schema (draft 2020-12) the OCR catalog emits per function. */
interface SchemaProp {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

interface ObjectSchema {
  type?: string;
  properties?: Record<string, SchemaProp>;
  required?: string[];
}

export type ArgValues = Record<string, unknown>;

const asObjectSchema = (schema: unknown): ObjectSchema | null => {
  if (!schema || typeof schema !== "object") return null;
  const s = schema as ObjectSchema;
  if (s.type !== "object" || !s.properties) return null;
  return s;
};

const propType = (prop: SchemaProp): string | undefined =>
  Array.isArray(prop.type) ? prop.type.find((t) => t !== "null") : prop.type;

const isRenderable = (prop: SchemaProp): boolean => {
  if (prop.enum) return true;
  const t = propType(prop);
  return t === "string" || t === "number" || t === "integer" || t === "boolean";
};

/** True when every field of the schema maps to a primitive control we can render. */
export const hasArgsForm = (schema: unknown): boolean => {
  const s = asObjectSchema(schema);
  if (!s) return false;
  const props = Object.values(s.properties ?? {});
  return props.length > 0 && props.every(isRenderable);
};

/** Seeds form state from the schema's declared defaults. */
export const defaultArgs = (schema: unknown): ArgValues => {
  const s = asObjectSchema(schema);
  if (!s) return {};
  const out: ArgValues = {};
  for (const [key, prop] of Object.entries(s.properties ?? {})) {
    if (prop.default !== undefined) out[key] = prop.default;
  }
  return out;
};

/** Drops empty/undefined entries so omitted fields fall back to backend defaults. */
export const cleanArgs = (values: ArgValues): ArgValues => {
  const out: ArgValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "") continue;
    out[key] = value;
  }
  return out;
};

interface SchemaFormProps {
  schema: unknown;
  values: ArgValues;
  onChange: (values: ArgValues) => void;
}

export const SchemaForm = ({ schema, values, onChange }: SchemaFormProps) => {
  const s = asObjectSchema(schema);
  if (!s) return null;

  const required = new Set(s.required ?? []);
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  return (
    <div className="space-y-3">
      {Object.entries(s.properties ?? {}).map(([key, prop]) => {
        const t = propType(prop);
        const label = (
          <label className="text-sm font-medium">
            {key}
            {required.has(key) && <span className="text-destructive"> *</span>}
          </label>
        );
        const hint = prop.description ? <p className="text-xs text-muted-foreground">{prop.description}</p> : null;

        if (prop.enum) {
          return (
            <div key={key} className="space-y-1.5">
              {label}
              <select
                value={String(values[key] ?? "")}
                onChange={(e) => set(key, e.target.value)}
                className={cn(
                  "h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none",
                  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                )}
              >
                {prop.enum.map((opt) => (
                  <option key={String(opt)} value={String(opt)}>
                    {String(opt)}
                  </option>
                ))}
              </select>
              {hint}
            </div>
          );
        }

        if (t === "boolean") {
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                {label}
                {hint}
              </div>
              <Switch checked={Boolean(values[key])} onCheckedChange={(checked) => set(key, checked)} />
            </div>
          );
        }

        const numeric = t === "number" || t === "integer";
        return (
          <div key={key} className="space-y-1.5">
            {label}
            <Input
              type={numeric ? "number" : "text"}
              value={values[key] === undefined ? "" : String(values[key])}
              min={prop.minimum}
              max={prop.maximum}
              step={t === "integer" ? 1 : "any"}
              maxLength={numeric ? undefined : prop.maxLength}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") return set(key, undefined);
                set(key, numeric ? Number(raw) : raw);
              }}
            />
            {hint}
          </div>
        );
      })}
    </div>
  );
};
