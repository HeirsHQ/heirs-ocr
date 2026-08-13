"use client";

import { useEffect, useState } from "react";

import { PageLayout, SchemaForm, cleanArgs, defaultArgs, hasArgsForm, type ArgValues } from "@/components/shared";
import type { OcrCatalogEntry, OcrErrorBody, OcrSuccess } from "@/types/ocr";
import { Textarea } from "@heirs/ui";
import { Button } from "@heirs/ui";
import { Input } from "@heirs/ui";
import { cn } from "@heirs/ui";

const Page = () => {
  const [functions, setFunctions] = useState<OcrCatalogEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [argValues, setArgValues] = useState<ArgValues>({});
  const [argsText, setArgsText] = useState("{}");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OcrSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the live function catalog via the same-origin proxy.
  useEffect(() => {
    fetch("/api/ocr/functions")
      .then((r) => r.json())
      .then((data: { functions?: OcrCatalogEntry[] }) => {
        setFunctions(data.functions ?? []);
        if (data.functions?.[0]) setSelectedKey(data.functions[0].key);
      })
      .catch(() => setError("Could not load the function catalog. Is the OCR API running?"));
  }, []);

  const selected = functions.find((f) => f.key === selectedKey);
  const schemaMode = selected ? hasArgsForm(selected.argsSchema) : false;

  // Reset the args editor to the selected function's defaults whenever it changes.
  // Adjusting state during render (React's recommended pattern) instead of an effect.
  const [argsForKey, setArgsForKey] = useState<string | null>(null);
  if (argsForKey !== selectedKey) {
    setArgsForKey(selectedKey);
    setArgValues(selected ? defaultArgs(selected.argsSchema) : {});
    setArgsText("{}");
    setError(null);
    setResult(null);
  }

  const run = async () => {
    setError(null);
    setResult(null);

    if (!file) {
      setError("Choose a file to process.");
      return;
    }

    // In schema mode the form guarantees valid args; otherwise validate the raw JSON.
    let argsPayload: string;
    if (schemaMode) {
      argsPayload = JSON.stringify(cleanArgs(argValues));
    } else {
      try {
        argsPayload = JSON.stringify(JSON.parse(argsText || "{}"));
      } catch {
        setError("Args must be valid JSON.");
        return;
      }
    }

    const form = new FormData();
    form.append("file", file);
    form.append("args", argsPayload);

    setRunning(true);
    try {
      const res = await fetch(`/api/ocr/${selectedKey}`, { method: "POST", body: form });
      const body = (await res.json()) as OcrSuccess | OcrErrorBody;
      if (!res.ok || "error" in body) {
        const err = (body as OcrErrorBody).error;
        setError(err ? `${err.code}: ${err.message}` : `Request failed (${res.status}).`);
      } else {
        setResult(body as OcrSuccess);
      }
    } catch {
      setError("Network error reaching the OCR API.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <PageLayout title="Run OCR" subtitle="Upload a document, pick a function, and see the structured result.">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Request */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Function</label>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className={cn(
                "h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none",
                "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
              )}
            >
              {functions.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.key}
                </option>
              ))}
            </select>
            {selected && (
              <p className="text-xs text-muted-foreground">
                {selected.description} · accepts {selected.accepts.join(", ")} · {selected.sensitivity} · up to{" "}
                {selected.maxPages} pages
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Document</label>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>

          {schemaMode ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Args</label>
              <SchemaForm schema={selected?.argsSchema} values={argValues} onChange={setArgValues} />
              <p className="text-xs text-muted-foreground">
                Function-specific options; defaults apply when a field is left empty.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Args (JSON)</label>
              <Textarea
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                rows={5}
                spellCheck={false}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Optional. This function takes a dynamic schema; enter args as JSON.
              </p>
            </div>
          )}

          <Button onClick={run} disabled={running || !selectedKey}>
            {running ? "Running…" : "Run"}
          </Button>
        </div>

        {/* Response */}
        <div className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {result && (
            <>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-md bg-muted px-2 py-1">provider: {result.meta.provider}</span>
                <span className="rounded-md bg-muted px-2 py-1">pages: {result.meta.pageCount}</span>
                <span className="rounded-md bg-muted px-2 py-1">{result.meta.durationMs} ms</span>
                {result.meta.cached && <span className="rounded-md bg-muted px-2 py-1">cached</span>}
                {result.meta.confidence !== undefined && (
                  <span className="rounded-md bg-muted px-2 py-1">confidence: {result.meta.confidence}</span>
                )}
              </div>
              <pre className="max-h-[60dvh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
                {JSON.stringify(result.result, null, 2)}
              </pre>
            </>
          )}

          {!error && !result && (
            <p className="text-sm text-muted-foreground">The structured result will appear here.</p>
          )}
        </div>
      </div>
    </PageLayout>
  );
};

export default Page;
