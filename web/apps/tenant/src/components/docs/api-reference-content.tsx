"use client";

import React, { useState } from "react";

import { CodeBlock } from "@/components/shared/code-block";
import { Prose, Section } from "./primitives";
import { CODE_BLOCKS } from "./code-blocks";
import { cn, TabPanel } from "@heirs/ui";

/**
 * The API reference body, minus the function catalog.
 *
 * Rendered by both `/api-reference` (marketing, signed out) and
 * `/developer/api-reference` (portal). Everything here is the stable contract —
 * auth, the request shape, errors, rate limits, webhooks — which does not change
 * when a function is added, so it is written once and shared.
 *
 * The per-function detail is the one part that differs between the two: the portal
 * generates it from the live catalog, while the marketing page cannot reach a
 * session-scoped endpoint. It is therefore a slot rather than a branch here — this
 * module has no opinion about who is reading it.
 */

const quickstart = (host: string) => `curl -X POST ${host}/v1/ocr/TEXT_EXTRACTION \\
  -H "Authorization: Bearer $HEIRS_API_KEY" \\
  -F "file=@invoice.pdf" \\
  -F 'args={"format":"markdown"}'`;

const SUCCESS = `{
  "requestId": "req_01J...",
  "function": "TEXT_EXTRACTION",
  "result": { "text": "..." },
  "meta": {
    "provider": "azure-document-intelligence",
    "pageCount": 3,
    "cached": false,
    "durationMs": 1840
  }
}`;

const asyncPath = (host: string) => `# Large documents return 202 instead of a result.
{ "jobId": "1734", "statusUrl": "/v1/ocr/jobs/1734" }

# Poll until status is "completed" or "failed".
curl ${host}/v1/ocr/jobs/1734 \\
  -H "Authorization: Bearer $HEIRS_API_KEY"`;

const ERROR_SHAPE = `{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Document allowance for this period is exhausted",
    "requestId": "req_01J...",
    "retryable": true
  }
}`;

const ERRORS: { code: string; status: string; meaning: string }[] = [
  { code: "UNAUTHORIZED", status: "401", meaning: "Missing, unknown, revoked or expired API key." },
  { code: "FORBIDDEN", status: "403", meaning: "The key or plan does not include this function." },
  { code: "PAYMENT_REQUIRED", status: "402", meaning: "Subscription expired, canceled or suspended." },
  { code: "QUOTA_EXCEEDED", status: "429", meaning: "Period or trial document allowance exhausted." },
  { code: "RATE_LIMITED", status: "429", meaning: "Too many requests in the current window. Retry after a pause." },
  { code: "INVALID_ARGS", status: "400", meaning: "Malformed args, or a missing file field." },
  { code: "UNSUPPORTED_MEDIA_TYPE", status: "415", meaning: "The sniffed file type is not accepted by this function." },
  { code: "PAGE_LIMIT_EXCEEDED", status: "400", meaning: "Document exceeds the function's or your plan's page cap." },
  { code: "PROVIDER_UNAVAILABLE", status: "503", meaning: "A backing store or vendor is unreachable. Retryable." },
  { code: "INTERNAL", status: "500", meaning: "Server-side fault. Not retryable — quote the requestId." },
];

const LANGUAGES = [
  { label: "TypeScript", value: "typescript" },
  { label: "Python", value: "python" },
  { label: "Go", value: "go" },
  { label: "Ruby", value: "ruby" },
  { label: "PHP", value: "php" },
  { label: "Java", value: "java" },
  { label: "C#", value: "csharp" },
  { label: "Rust", value: "rust" },
];

interface Props {
  /**
   * Body of the Functions section. The portal passes the live catalog; the
   * marketing page passes a prompt to sign in for it.
   */
  functions: React.ReactNode;
  /**
   * Base URL to print in the examples. Comes from `publicApiUrl()`, so a
   * deployment sets it once and every snippet on every page follows — nobody has
   * to notice that a copied curl line still points at the placeholder.
   */
  host: string;
}

export const ApiReferenceContent = ({ functions, host }: Props) => {
  const [selected, setSelected] = useState(LANGUAGES[0].value);

  return (
    <div className="space-y-10">
      <Section id="auth" title="Authentication">
        <Prose>
          Every request carries an API key from the <strong>API Keys</strong> page, as either{" "}
          <code className="font-mono text-xs">Authorization: Bearer &lt;key&gt;</code> or{" "}
          <code className="font-mono text-xs">X-API-Key: &lt;key&gt;</code>. The raw key is shown once when it is minted
          and is not recoverable afterwards — only its hash is stored, so a lost key must be replaced rather than looked
          up. Keys can be given an expiry, and revoking one takes effect within a minute.
        </Prose>
      </Section>
      <Section id="quickstart" title="Quickstart">
        <Prose>
          Send the document in the <code className="font-mono text-xs">file</code> field and any options as a JSON
          string in <code className="font-mono text-xs">args</code>. Exactly one file per request.
        </Prose>
        <CodeBlock language="bash" code={quickstart(host)} />
        <Prose>
          The file type is determined from the content, not the filename or the declared MIME type — a{" "}
          <code className="font-mono text-xs">.pdf</code> that is really a JPEG is processed as an image.
        </Prose>
        <CodeBlock language="json" code={SUCCESS} />
        <Prose>
          Log the <code className="font-mono text-xs">requestId</code> on every response. It appears on the Request Logs
          page and is what support needs to trace a specific call.
        </Prose>
      </Section>
      <Section id="async" title="Large documents">
        <Prose>
          Documents past a size or page threshold are queued instead of processed inline, and the call returns{" "}
          <strong>202</strong> with a job id. Treat a 202 as success and poll the status URL; a job ends as{" "}
          <code className="font-mono text-xs">completed</code> or <code className="font-mono text-xs">failed</code>. You
          can also watch them on the Job Queues page.
        </Prose>
        <CodeBlock language="bash" code={asyncPath(host)} />
      </Section>
      <Section id="functions" title="Functions">
        {functions}
      </Section>
      <Section id="errors" title="Errors">
        <Prose>
          Failures use one envelope. <code className="font-mono text-xs">retryable</code> says whether repeating the
          same request could succeed — a 429 will, a 400 will not.
        </Prose>
        <CodeBlock language="json" code={ERROR_SHAPE} />
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {ERRORS.map((e) => (
                <tr key={e.code} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{e.code}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{e.status}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{e.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section id="rate-limits" title="Rate limits">
        <Prose>
          Requests are counted per organisation over a fixed window; the ceiling comes from your plan. Exceeding it
          returns <code className="font-mono text-xs">RATE_LIMITED</code>, which is retryable — back off and retry
          rather than looping. Separately, your plan caps documents per billing period; exhausting that returns{" "}
          <code className="font-mono text-xs">QUOTA_EXCEEDED</code>. Both appear on the Request Logs page, which is the
          only place a refused call is visible.
        </Prose>
      </Section>
      <Section id="webhooks" title="Webhooks">
        <Prose>
          Register an endpoint under <strong>Webhooks</strong> to receive{" "}
          <code className="font-mono text-xs">document.processed</code> and{" "}
          <code className="font-mono text-xs">document.failed</code> events. Each delivery carries{" "}
          <code className="font-mono text-xs">X-Heirs-Signature</code>,{" "}
          <code className="font-mono text-xs">X-Heirs-Delivery</code> (stable across retries — use it to make your
          handler idempotent) and <code className="font-mono text-xs">X-Heirs-Event</code>.
        </Prose>
        <Prose>
          <strong>Always verify the signature</strong> before trusting a payload, and respond 2xx quickly. Anything else
          is retried with exponential backoff up to six attempts, then marked dead.
        </Prose>
        <div className="flex items-center p-1 bg-muted rounded-md w-fit">
          {LANGUAGES.map((lang) => (
            <button
              className={cn(
                "text-sm px-3 py-1 rounded-md",
                selected === lang.value ? "bg-primary text-white" : "text-muted-foreground",
              )}
              key={lang.value}
              onClick={() => setSelected(lang.value)}
            >
              {lang.label}
            </button>
          ))}
        </div>
        {LANGUAGES.map((lang) => (
          <TabPanel key={lang.value} selected={selected} value={lang.value}>
            <CodeBlock language={selected} code={CODE_BLOCKS[selected]} />
          </TabPanel>
        ))}
      </Section>
    </div>
  );
};
