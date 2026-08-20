"use client";

import { useEffect, useState } from "react";

import { PageLayout, SchemaForm, cleanArgs, defaultArgs, hasArgsForm, type ArgValues } from "@/components/shared";
import { useInvalidateAfterOcrRun } from "@/hooks/api/use-tenant-documents";
import { Field, ScrollArea, SelectOption, StatusBadge } from "@heirs/ui";
import { Textarea } from "@heirs/ui";
import { Button } from "@heirs/ui";
import { Input } from "@heirs/ui";
import type {
  OcrAccepted,
  OcrCatalogEntry,
  OcrErrorBody,
  OcrJobRecord,
  OcrJobStatus,
  OcrResponseMeta,
  OcrSuccess,
} from "@/types/ocr";

/** Mirrors the backend's MAX_FILE_SIZE_BYTES default — rejects locally before a long upload. */
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** How often to re-check a queued job. */
const POLL_INTERVAL_MS = 2_000;

/** Coarse `accepts` groups (from the catalog) → an `accept` attribute for the picker. */
const ACCEPT_ATTR: Record<string, string> = {
  pdf: "application/pdf,.pdf",
  image: "image/*",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx",
  text: "text/plain,text/markdown,.txt,.md",
};

/** Whichever of the two paths produced it, a finished run renders identically. */
type RunResult = {
  result: unknown;
  meta?: OcrResponseMeta;
  requestId?: string;
  function?: string;
};

/**
 * Turns a typed backend code into something a tenant can act on. Billing denials in
 * particular arrive as bare codes (`QUOTA_EXCEEDED`, `PAYMENT_REQUIRED`) that mean
 * nothing to the person holding the document.
 */
const explainError = (code: string, message: string): string => {
  switch (code) {
    case "PAYMENT_REQUIRED":
      return `${message} Ask an owner on your account to update the subscription before running more documents.`;
    case "QUOTA_EXCEEDED":
      return `${message} The allowance resets at the start of the next billing period, or an owner can upgrade the plan.`;
    case "RATE_LIMITED":
      return `${message} This is a short-term limit — wait a moment and run it again.`;
    case "FORBIDDEN":
      return `${message} Your current plan or API key does not cover this function.`;
    case "FILE_TOO_LARGE":
    case "PAGE_LIMIT_EXCEEDED":
    case "UNSUPPORTED_MEDIA_TYPE":
      return message;
    default:
      return message || `Request failed (${code}).`;
  }
};

/** One `label: value` pair from the run's metadata; values are mono so they line up. */
const Meta = ({ label, value }: { label: string; value: string | number }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-muted-foreground text-[0.625rem] font-medium tracking-wider uppercase">{label}</dt>
    <dd className="font-mono text-xs tabular-nums">{value}</dd>
  </div>
);

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

const Page = () => {
  // Refreshes Documents / Reports / Billing once a run settles. Stable across
  // renders, so the polling effect below can depend on it without re-subscribing.
  const refreshAfterRun = useInvalidateAfterOcrRun();
  const [functions, setFunctions] = useState<OcrCatalogEntry[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [argValues, setArgValues] = useState<ArgValues>({});
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [argsText, setArgsText] = useState("{}");
  const [running, setRunning] = useState(false);

  // Set when the backend queues the document (202) instead of processing inline.
  const [jobStatus, setJobStatus] = useState<OcrJobStatus | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  // Load the live function catalog via the same-origin proxy.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ocr/functions", { cache: "no-store" });
        const body = (await res.json()) as { functions?: OcrCatalogEntry[] } & Partial<OcrErrorBody>;
        if (cancelled) return;
        // A 401/500 still parses as JSON, so an unchecked `data.functions ?? []`
        // would leave an empty picker and no explanation.
        if (!res.ok || body.error) {
          setError(
            body.error
              ? explainError(body.error.code, body.error.message)
              : `Could not load the function catalog (${res.status}).`,
          );
          return;
        }
        setFunctions(body.functions ?? []);
        if (body.functions?.[0]) setSelectedKey(body.functions[0].key);
      } catch {
        if (!cancelled) setError("Could not load the function catalog. Is the OCR API running?");
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll a queued job to completion. Anything over the backend's size/page threshold
  // takes this path, so it is the normal case for a multi-page scan — not an edge.
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const stop = (fail?: string) => {
      if (fail) setError(fail);
      setJobId(null);
      setJobStatus(null);
      setRunning(false);
    };

    const poll = async () => {
      try {
        const res = await fetch(`/api/ocr/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const body = (await res.json()) as OcrJobRecord & Partial<OcrErrorBody>;
        if (cancelled) return;

        if (!res.ok) {
          stop(
            body.error
              ? explainError(body.error.code, body.error.message)
              : `Could not read job status (${res.status}).`,
          );
          return;
        }

        setJobStatus(body.status);
        if (body.status === "completed") {
          setResult({ result: body.result, meta: body.meta, requestId: body.requestId, function: body.function });
          // Same refresh as the sync path — on the queued path the registry row and
          // the metering only exist once the worker has finished, so it belongs here
          // rather than at submit time.
          void refreshAfterRun();
          stop();
          return;
        }
        if (body.status === "failed") {
          // Failures are recorded in the document registry too, so the list is stale
          // here as well — a tenant looking for the run that just bounced expects it.
          void refreshAfterRun();
          stop(body.error ? explainError(body.error.code, body.error.message) : "The job failed.");
          return;
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) stop("Lost contact with the OCR API while waiting for the job.");
      }
    };

    timer = setTimeout(poll, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, refreshAfterRun]);

  const selected = functions.find((f) => f.key === selectedKey);
  const schemaMode = selected ? hasArgsForm(selected.argsSchema) : false;
  const busy = running || jobId !== null;

  const acceptAttr = selected?.accepts
    .map((group) => ACCEPT_ATTR[group])
    .filter(Boolean)
    .join(",");

  // Reset the args editor to the selected function's defaults whenever it changes.
  // Adjusting state during render (React's recommended pattern) instead of an effect.
  const [argsForKey, setArgsForKey] = useState<string | null>(null);
  if (argsForKey !== selectedKey) {
    setArgsForKey(selectedKey);
    setArgValues(selected ? defaultArgs(selected.argsSchema) : {});
    setArgsText("{}");
    setError(null);
    setResult(null); // a result belongs to the function that produced it
  }

  const run = async () => {
    setError(null);
    setResult(null);

    if (!file) {
      setError("Choose a file to process.");
      return;
    }
    // Check locally rather than making the user wait through an upload the server
    // will reject: the caps are already known from the catalog and env.
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_SIZE_BYTES)}.`);
      return;
    }
    if (file.size === 0) {
      setError("That file is empty.");
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
      const body = (await res.json()) as OcrSuccess | OcrAccepted | OcrErrorBody;

      if (!res.ok || "error" in body) {
        const err = (body as OcrErrorBody).error;
        setError(err ? explainError(err.code, err.message) : `Request failed (${res.status}).`);
        // A failure inside the pipeline is still recorded as a document; one refused
        // before it (quota, auth) is not. The client cannot tell the two apart, and a
        // redundant refetch is far cheaper than a silently stale list.
        void refreshAfterRun();
        setRunning(false);
        return;
      }

      // 202: the document was queued. Hand off to the polling effect — treating this
      // as a result would render `meta` off an object that has none.
      if (res.status === 202 && "jobId" in body) {
        setJobStatus("queued");
        setJobId(body.jobId);
        return; // `running` stays true until the job settles
      }

      setResult(body as OcrSuccess);
      // The run landed a document row and metered against the subscription; tell the
      // cache so Documents / Reports / Billing don't keep showing the pre-run state.
      void refreshAfterRun();
      setRunning(false);
    } catch {
      setError("Network error reaching the OCR API.");
      setRunning(false);
    }
  };

  return (
    <PageLayout title="Run OCR" subtitle="Upload a document, pick a function, and see the structured result.">
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="bg-card border-hairline space-y-5 rounded-lg border p-5">
          <Field
            label="Function"
            htmlFor="ocr-function"
            hint={
              selected
                ? `${selected.description} · accepts ${selected.accepts.join(", ")} · ${selected.sensitivity} · up to ${selected.maxPages} pages`
                : undefined
            }
          >
            <SelectOption
              id="ocr-function"
              value={selectedKey || undefined}
              onValueChange={setSelectedKey}
              // Locked mid-run so a job started for one function can't resolve into
              // the panel while a different one is selected.
              disabled={busy || catalogLoading || functions.length === 0}
              placeholder={
                catalogLoading
                  ? "Loading functions…"
                  : functions.length === 0
                    ? "No functions available"
                    : "Pick a function"
              }
              options={functions.map((f) => ({ label: f.key.replace(/_/g, " "), value: f.key }))}
            />
          </Field>
          <Field
            label="Document"
            renderControl={(id) => (
              <Input
                id={id}
                type="file"
                accept={acceptAttr || undefined}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            )}
            hint={file ? `${file.name} · ${formatBytes(file.size)}` : undefined}
          />
          {schemaMode ? (
            <Field label="Args" hint="Function-specific options; defaults apply when a field is left empty.">
              <SchemaForm schema={selected?.argsSchema} values={argValues} onChange={setArgValues} />
            </Field>
          ) : (
            <Field
              label="Args (JSON)"
              hint="Optional. This function takes a dynamic schema; enter args as JSON."
              renderControl={(id) => (
                <Textarea
                  id={id}
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  rows={5}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              )}
            />
          )}
          <Button onClick={run} disabled={busy || !selectedKey} className="w-full sm:w-auto">
            {busy ? "Running…" : "Run document"}
          </Button>
        </div>
        <div className="bg-card border-hairline space-y-4 rounded-lg border p-5">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {jobId && (
            <div className="border-hairline space-y-2 rounded-md border px-3 py-3 text-sm">
              <StatusBadge
                tone="pending"
                label={jobStatus === "active" ? "Processing" : "Queued"}
                className="normal-case"
              />
              <p className="text-muted-foreground text-xs text-pretty">
                This document was large enough to run in the background. It keeps going if you leave the page — job{" "}
                <span className="text-foreground font-mono">{jobId}</span>.
              </p>
            </div>
          )}
          {result && (
            <>
              {result.meta && (
                <dl className="border-hairline flex flex-wrap gap-x-6 gap-y-2 rounded-md border px-3 py-2.5">
                  <Meta label="Provider" value={result.meta.provider} />
                  <Meta label="Pages" value={result.meta.pageCount} />
                  <Meta label="Duration" value={`${result.meta.durationMs} ms`} />
                  {result.meta.confidence !== undefined && <Meta label="Confidence" value={result.meta.confidence} />}
                  {result.meta.cached && <Meta label="Source" value="cached" />}
                </dl>
              )}
              {result.requestId && (
                <p className="text-xs text-muted-foreground">
                  Request <span className="font-mono">{result.requestId}</span> — quote this when contacting support.
                </p>
              )}
              <ScrollArea className="min-h-0">
                <pre className="border-hairline bg-muted/40 max-h-[60dvh] max-w-full overflow-x-hidden overflow-y-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap wrap-anywhere">
                  {JSON.stringify(result.result, null, 2)}
                </pre>
              </ScrollArea>
            </>
          )}
          {!error && !result && !jobId && (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Pick a function and a document, then run it. The structured result appears here.
            </p>
          )}
        </div>
      </div>
    </PageLayout>
  );
};

export default Page;
