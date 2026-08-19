"use client";

import { useMemo, useState } from "react";
import { BookOpen } from "lucide-react";

import { CodeBlock } from "@/components/shared/code-block";
import { useOcrCatalog } from "@/hooks/api/use-ocr-catalog";
import type { OcrCatalogEntry } from "@/types/ocr";
import { EmptyState, ErrorState, SelectOption, Skeleton, StatusBadge } from "@heirs/ui";

import { Prose } from "./primitives";

/** `RECEIPT_PARSING` → `Receipt parsing`. The catalog key is an id, not a label. */
export const humanize = (key: string): string => {
  const words = key.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const FunctionCard = ({ fn }: { fn: OcrCatalogEntry }) => {
  const schema = fn.argsSchema ? JSON.stringify(fn.argsSchema, null, 2) : null;

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{humanize(fn.key)}</p>
          <code className="font-mono text-xs text-muted-foreground">{fn.key}</code>
        </div>
        {/* PII functions behave differently in ways a caller must know about, so the
            classification is surfaced rather than buried in prose. */}
        <StatusBadge
          tone={fn.sensitivity === "standard" ? "inactive" : "attention"}
          label={fn.sensitivity}
          className="normal-case"
        />
      </div>

      <Prose className="text-foreground">{fn.description}</Prose>

      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Accepts</dt>
          <dd className="font-mono">{fn.accepts.join(", ")}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Max pages</dt>
          <dd className="font-mono">{fn.maxPages}</dd>
        </div>
      </dl>

      {schema && schema !== "{}" && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Arguments schema
          </summary>
          <CodeBlock className="mt-2" language="json" code={schema} />
        </details>
      )}

      {fn.sensitivity !== "standard" && (
        <Prose className="text-xs">
          Runs inline (never queued), is never cached, and leaves no entry under Documents — not even a filename.
          Webhook payloads for it omit the filename too.
        </Prose>
      )}
    </div>
  );
};

/**
 * The Functions section, rendered from the live catalog.
 *
 * Portal-only: the catalog proxy is session-scoped, so this needs a signed-in
 * tenant. The marketing copy of the reference passes a sign-in prompt into the same
 * slot instead of rendering nothing, so the section never silently disappears.
 */
export const LiveFunctionCatalog = () => {
  const catalog = useOcrCatalog();
  const [sensitivity, setSensitivity] = useState("");

  const functions = useMemo(() => {
    const all = catalog.data ?? [];
    return sensitivity ? all.filter((f) => f.sensitivity === sensitivity) : all;
  }, [catalog.data, sensitivity]);

  const sensitivities = useMemo(() => {
    const seen = [...new Set((catalog.data ?? []).map((f) => f.sensitivity))];
    return [{ label: "All functions", value: "" }, ...seen.map((s) => ({ label: humanize(s), value: s }))];
  }, [catalog.data]);

  return (
    <>
      <Prose>
        Generated from the live catalog, so this list is always what the service actually offers. The same catalog is
        available at <code className="font-mono text-xs">GET /v1/ocr/functions</code>.
      </Prose>

      {catalog.isError ? (
        <ErrorState
          title="Couldn't load the function catalog"
          description={catalog.error instanceof Error ? catalog.error.message : "Unknown error"}
          onRetry={() => catalog.refetch()}
          retrying={catalog.isFetching}
        />
      ) : catalog.isPending ? (
        <Skeleton skeleton="table" rows={4} />
      ) : (
        <>
          <SelectOption
            options={sensitivities}
            value={sensitivity}
            onValueChange={setSensitivity}
            placeholder="All functions"
            className="w-52"
          />
          {functions.length === 0 ? (
            <EmptyState icon={BookOpen} title="No functions match" description="Try clearing the filter." />
          ) : (
            <div className="space-y-3">
              {functions.map((fn) => (
                <FunctionCard key={fn.key} fn={fn} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
};
