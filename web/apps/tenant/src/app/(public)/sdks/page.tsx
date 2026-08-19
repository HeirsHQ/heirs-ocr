import type { Metadata } from "next";
import { Box } from "lucide-react";
import Link from "next/link";

import { DocsHero, Prose, Section } from "@/components/docs";
import { CodeBlock } from "@/components/shared/code-block";
import { publicApiUrl } from "@/lib/ocr";

export const metadata: Metadata = {
  title: "SDKs — Heirs OCR",
  description:
    "There is no client library to install. Copy-paste clients for the Heirs OCR API in TypeScript, Python, PHP and Go.",
};

const typescript = (host: string) => `import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const HOST = process.env.HEIRS_OCR_HOST ?? "${host}";

export async function run(fn, path, args = {}) {
  const form = new FormData();
  // Exactly one file per request. The filename is passed for logging only — the
  // type is sniffed from the bytes, so the extension does not decide anything.
  form.set("file", new Blob([await readFile(path)]), basename(path));
  // args is a JSON *string* in one field, not a field per argument.
  form.set("args", JSON.stringify(args));

  const res = await fetch(\`\${HOST}/v1/ocr/\${fn}\`, {
    method: "POST",
    headers: { Authorization: \`Bearer \${process.env.HEIRS_API_KEY}\` },
    // No Content-Type header: fetch sets it, with the multipart boundary. Setting
    // it by hand omits the boundary and the upload is rejected as malformed.
    body: form,
  });

  const body = await res.json();
  if (!res.ok) {
    const { code, message, requestId } = body.error;
    throw new Error(\`\${code}: \${message} (\${requestId})\`);
  }
  // 200 → { requestId, function, result, meta }
  // 202 → { requestId, jobId, status, statusUrl } — see Large documents below.
  return { status: res.status, ...body };
}`;

const python = (host: string) => `import json
import os

import requests

HOST = os.environ.get("HEIRS_OCR_HOST", "${host}")


def run(fn, path, args=None):
    with open(path, "rb") as fh:
        res = requests.post(
            f"{HOST}/v1/ocr/{fn}",
            headers={"Authorization": f"Bearer {os.environ['HEIRS_API_KEY']}"},
            # requests builds the multipart body and its boundary from these two.
            files={"file": (os.path.basename(path), fh)},
            data={"args": json.dumps(args or {})},
            # Synchronous runs are bounded but not instant; do not leave this at
            # the default of no timeout.
            timeout=120,
        )

    body = res.json()
    if not res.ok:
        err = body["error"]
        raise RuntimeError(f"{err['code']}: {err['message']} ({err['requestId']})")
    return res.status_code, body`;

const php = (host: string) => `<?php

function run(string $fn, string $path, array $args = []): array
{
    $host = getenv('HEIRS_OCR_HOST') ?: '${host}';
    $ch = curl_init("$host/v1/ocr/$fn");

    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . getenv('HEIRS_API_KEY')],
        // Passing an array makes curl send multipart/form-data and set the
        // boundary itself. json_encode keeps args a single string field.
        CURLOPT_POSTFIELDS => [
            'file' => new CURLFile($path),
            'args' => json_encode($args ?: new stdClass()),
        ],
    ]);

    $raw = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    $body = json_decode($raw, true);
    if ($status >= 400) {
        $e = $body['error'];
        throw new RuntimeException("{$e['code']}: {$e['message']} ({$e['requestId']})");
    }

    return [$status, $body];
}`;

const go = (host: string) => `package heirsocr

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
)

func Run(fn, path string, args any) (int, map[string]any, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, nil, err
	}
	defer file.Close()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", filepath.Base(path))
	if err != nil {
		return 0, nil, err
	}
	if _, err := io.Copy(part, file); err != nil {
		return 0, nil, err
	}
	encoded, err := json.Marshal(args)
	if err != nil {
		return 0, nil, err
	}
	w.WriteField("args", string(encoded))
	// Close before sending: it writes the trailing boundary, without which the
	// server sees a truncated body.
	w.Close()

	host := os.Getenv("HEIRS_OCR_HOST")
	if host == "" {
		host = "${host}"
	}
	req, err := http.NewRequest("POST", host+"/v1/ocr/"+fn, &buf)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("HEIRS_API_KEY"))
	req.Header.Set("Content-Type", w.FormDataContentType())

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer res.Body.Close()

	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return 0, nil, err
	}
	if res.StatusCode >= 400 {
		e := body["error"].(map[string]any)
		return res.StatusCode, body, fmt.Errorf("%v: %v (%v)", e["code"], e["message"], e["requestId"])
	}
	return res.StatusCode, body, nil
}`;

const POLLING = `// A 202 is a success: the document was too large to run inline and is queued.
// The job id is the only handle on it, so persist it before you start polling —
// a process that dies mid-poll otherwise loses a document it has been billed for.
export async function awaitResult(submission, { timeoutMs = 300_000 } = {}) {
  if (submission.status !== 202) return submission;

  const deadline = Date.now() + timeoutMs;
  let wait = 1_000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 15_000); // back off; the queue is not a busy-wait

    const res = await fetch(\`\${HOST}/v1/ocr/jobs/\${submission.jobId}\`, {
      headers: { Authorization: \`Bearer \${process.env.HEIRS_API_KEY}\` },
    });
    const job = await res.json();

    if (job.status === "completed") return job;
    if (job.status === "failed") throw new Error(job.error?.code ?? "JOB_FAILED");
  }

  throw new Error(\`Job \${submission.jobId} did not finish within \${timeoutMs}ms\`);
}`;

const Page = () => {
  const host = publicApiUrl();

  return (
    <div>
      <DocsHero
        eyebrow="Developers"
        icon={Box}
        title="SDKs"
        subtitle="There is nothing to install. The API is one multipart endpoint — here is the whole client, in four languages."
      />
      <section className="py-16">
        <div className="mx-auto max-w-3xl space-y-10 px-4 sm:px-6">
          <Section id="no-sdk" title="Why there is no package">
            <Prose>
              The whole API is a <code className="font-mono text-xs">POST</code> of one file to one URL with a bearer
              key. A client library for that would be more code to keep in step with the service than the request it
              hides, and it would put a version boundary between you and a catalog that gains functions without breaking
              anything. So the request is documented instead of wrapped — every snippet below is complete,
              dependency-free where the runtime allows, and safe to paste into a project as-is.
            </Prose>
            <Prose>
              We do not publish official client libraries today. If you would rather generate one, each function&apos;s{" "}
              <code className="font-mono text-xs">argsSchema</code> in{" "}
              <code className="font-mono text-xs">GET /v1/ocr/functions</code> is JSON Schema, so a generator will give
              you typed arguments straight from the live catalog — see the{" "}
              <Link href="/api-reference" className="text-primary underline underline-offset-4">
                API reference
              </Link>
              .
            </Prose>
          </Section>

          <Section id="typescript" title="TypeScript / Node">
            <Prose>
              No dependencies: <code className="font-mono text-xs">fetch</code>,{" "}
              <code className="font-mono text-xs">FormData</code> and <code className="font-mono text-xs">Blob</code>{" "}
              are built in from Node 18. The same code runs unchanged in Deno, Bun and any edge runtime.
            </Prose>
            <CodeBlock language="typescript" code={typescript(host)} />
          </Section>

          <Section id="python" title="Python">
            <Prose>
              Using <code className="font-mono text-xs">requests</code>. Note that{" "}
              <code className="font-mono text-xs">args</code> goes in <code className="font-mono text-xs">data</code>,
              not <code className="font-mono text-xs">files</code> — it is a form field holding JSON, not an uploaded
              part.
            </Prose>
            <CodeBlock language="python" code={python(host)} />
          </Section>

          <Section id="php" title="PHP">
            <Prose>
              Using <code className="font-mono text-xs">ext-curl</code>, which ships with every supported PHP build.
            </Prose>
            <CodeBlock language="php" code={php(host)} />
          </Section>

          <Section id="go" title="Go">
            <Prose>
              Standard library only — <code className="font-mono text-xs">mime/multipart</code> writes the body and{" "}
              <code className="font-mono text-xs">FormDataContentType</code> supplies the matching header.
            </Prose>
            <CodeBlock language="go" code={go(host)} />
          </Section>

          <Section id="async" title="Large documents">
            <Prose>
              Past a size or page threshold a document is queued and the call returns <strong>202</strong> with a job id
              instead of a result. Any client that treats a non-200 as a failure will drop those documents on the floor,
              so handle the 202 explicitly and poll <code className="font-mono text-xs">GET /v1/ocr/jobs/:id</code>{" "}
              until the job is <code className="font-mono text-xs">completed</code> or{" "}
              <code className="font-mono text-xs">failed</code>. Registering a webhook is the better option if you can
              receive one — you are then told, rather than asking.
            </Prose>
            <CodeBlock language="typescript" code={POLLING} />
          </Section>

          <Section id="keys" title="Keys and secrets">
            <Prose>
              Every snippet reads the key from the environment, which is the only place it should live. The raw key is
              shown once when it is minted and only its hash is stored, so a key committed to a repository cannot be
              looked up and rotated quietly — it has to be revoked and replaced. Keys are per-environment: mint a
              separate one for staging rather than sharing production&apos;s.
            </Prose>
          </Section>
        </div>
      </section>
    </div>
  );
};

export default Page;
