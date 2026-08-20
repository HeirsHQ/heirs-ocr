/**
 * Source text for every snippet on the API reference.
 *
 * Both records are keyed by the Prism grammar id used in `LANGUAGES`, so adding a
 * tab is adding a key here and nothing else. `QUICK_STARTS` takes the host because
 * its examples print an absolute URL: `publicApiUrl()` resolves that per
 * deployment, so a reader copies a line that points at their own API rather than a
 * placeholder they have to notice and edit.
 *
 * Each quickstart is the same request in a different language — one document to
 * `TEXT_EXTRACTION`, `file` and `args` as multipart fields, the error envelope
 * checked before the result is read. They are whole programs on purpose: the
 * imports and the error branch are exactly what a fragment leaves out and a reader
 * then files a ticket about.
 */
export const QUICK_STARTS = (host: string): Record<string, string> => ({
  bash: `curl -X POST ${host}/v1/ocr/TEXT_EXTRACTION \\
  -H "Authorization: Bearer $HEIRS_API_KEY" \\
  -F "file=@invoice.pdf" \\
  -F 'args={"format":"markdown"}'`,
  typescript: `import { readFile } from "node:fs/promises";

const form = new FormData();
// Exactly one file per request. The filename travels for logging only — the type
// is sniffed from the bytes, so the extension decides nothing.
form.set("file", new Blob([await readFile("invoice.pdf")]), "invoice.pdf");
// args is a JSON *string* in one field, not a field per argument.
form.set("args", JSON.stringify({ format: "markdown" }));

const res = await fetch("${host}/v1/ocr/TEXT_EXTRACTION", {
  method: "POST",
  // No Content-Type header: fetch sets it, with the multipart boundary. Setting
  // it by hand omits the boundary and the upload is rejected as malformed.
  headers: { Authorization: \`Bearer \${process.env.HEIRS_API_KEY}\` },
  body: form,
});

const body = await res.json();
if (!res.ok) {
  const { code, message, requestId } = body.error;
  throw new Error(\`\${code}: \${message} (\${requestId})\`);
}

// 200 → { requestId, function, result, meta }; 202 → a queued job, see below.
console.log(res.status, body.result);`,
  python: `import json
import os

import requests

with open("invoice.pdf", "rb") as fh:
    res = requests.post(
        "${host}/v1/ocr/TEXT_EXTRACTION",
        headers={"Authorization": f"Bearer {os.environ['HEIRS_API_KEY']}"},
        # requests builds the multipart body and its boundary from these two.
        files={"file": ("invoice.pdf", fh)},
        # args is a JSON string in one field, not a field per argument.
        data={"args": json.dumps({"format": "markdown"})},
        # Synchronous runs are bounded but not instant; do not leave this at the
        # default of no timeout.
        timeout=120,
    )

body = res.json()
if not res.ok:
    err = body["error"]
    raise RuntimeError(f"{err['code']}: {err['message']} ({err['requestId']})")

# 200 → result inline; 202 → a queued job, see below.
print(res.status_code, body["result"])`,
  go: `package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
)

func main() {
	file, err := os.Open("invoice.pdf")
	if err != nil {
		panic(err)
	}
	defer file.Close()

	var body bytes.Buffer
	form := multipart.NewWriter(&body)

	part, err := form.CreateFormFile("file", "invoice.pdf")
	if err != nil {
		panic(err)
	}
	if _, err := io.Copy(part, file); err != nil {
		panic(err)
	}
	// args is a JSON string in one field, not a field per argument.
	form.WriteField("args", \`{"format":"markdown"}\`)
	// Close writes the trailing boundary, and has to run before the request is
	// sent rather than being deferred — an unterminated body is malformed.
	form.Close()

	req, err := http.NewRequest(http.MethodPost, "${host}/v1/ocr/TEXT_EXTRACTION", &body)
	if err != nil {
		panic(err)
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("HEIRS_API_KEY"))
	// Carries the boundary the writer generated.
	req.Header.Set("Content-Type", form.FormDataContentType())

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()

	var out map[string]any
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		panic(err)
	}
	if res.StatusCode >= 400 {
		e := out["error"].(map[string]any)
		panic(fmt.Sprintf("%v: %v (%v)", e["code"], e["message"], e["requestId"]))
	}

	fmt.Println(res.StatusCode, out["result"])
}`,
  ruby: `require "json"
require "net/http"
require "uri"

uri = URI("${host}/v1/ocr/TEXT_EXTRACTION")

req = Net::HTTP::Post.new(uri)
req["Authorization"] = "Bearer #{ENV.fetch('HEIRS_API_KEY')}"
# set_form with multipart/form-data builds the body and its boundary. args is a
# JSON string in one field, not a field per argument.
req.set_form(
  [
    ["file", File.open("invoice.pdf"), { filename: "invoice.pdf" }],
    ["args", JSON.generate({ format: "markdown" })]
  ],
  "multipart/form-data"
)

res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") do |http|
  http.request(req)
end

body = JSON.parse(res.body)
unless res.is_a?(Net::HTTPSuccess)
  err = body["error"]
  raise "#{err['code']}: #{err['message']} (#{err['requestId']})"
end

# 200 → result inline; 202 → a queued job, see below.
puts res.code, body["result"]`,
  php: `<?php

$ch = curl_init('${host}/v1/ocr/TEXT_EXTRACTION');

curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . getenv('HEIRS_API_KEY')],
    // Passing an array makes curl send multipart/form-data and set the boundary
    // itself. json_encode keeps args a single string field.
    CURLOPT_POSTFIELDS => [
        'file' => new CURLFile('invoice.pdf'),
        'args' => json_encode(['format' => 'markdown']),
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

// 200 → result inline; 202 → a queued job, see below.
print_r([$status, $body['result']]);`,
  java: `import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class Quickstart {
  public static void main(String[] argv) throws Exception {
    Path document = Path.of("invoice.pdf");
    // java.net.http has no multipart builder, so the body is assembled by hand.
    // This boundary and the one in the Content-Type header have to match.
    String boundary = "heirs-" + System.nanoTime();

    ByteArrayOutputStream body = new ByteArrayOutputStream();
    body.write(("--" + boundary + "\\r\\n"
        + "Content-Disposition: form-data; name=\\"file\\"; filename=\\"invoice.pdf\\"\\r\\n"
        + "Content-Type: application/octet-stream\\r\\n\\r\\n").getBytes(StandardCharsets.UTF_8));
    body.write(Files.readAllBytes(document));
    // args is a JSON string in one field, not a field per argument.
    body.write(("\\r\\n--" + boundary + "\\r\\n"
        + "Content-Disposition: form-data; name=\\"args\\"\\r\\n\\r\\n"
        + "{\\"format\\":\\"markdown\\"}\\r\\n"
        + "--" + boundary + "--\\r\\n").getBytes(StandardCharsets.UTF_8));

    HttpRequest request = HttpRequest.newBuilder(URI.create("${host}/v1/ocr/TEXT_EXTRACTION"))
        .header("Authorization", "Bearer " + System.getenv("HEIRS_API_KEY"))
        .header("Content-Type", "multipart/form-data; boundary=" + boundary)
        .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
        .build();

    HttpResponse<String> response =
        HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());

    if (response.statusCode() >= 400) {
      throw new RuntimeException(response.body());
    }

    // 200 → result inline; 202 → a queued job, see below.
    System.out.println(response.statusCode() + " " + response.body());
  }
}`,
  csharp: `using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading.Tasks;

public static class Quickstart
{
    public static async Task Main()
    {
        using var client = new HttpClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            Environment.GetEnvironmentVariable("HEIRS_API_KEY"));

        // MultipartFormDataContent sets Content-Type and the boundary itself.
        using var form = new MultipartFormDataContent();
        form.Add(new StreamContent(File.OpenRead("invoice.pdf")), "file", "invoice.pdf");
        // args is a JSON string in one field, not a field per argument.
        form.Add(new StringContent("""{"format":"markdown"}"""), "args");

        var response = await client.PostAsync("${host}/v1/ocr/TEXT_EXTRACTION", form);
        var body = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException(body);
        }

        // 200 → result inline; 202 → a queued job, see below.
        Console.WriteLine($"{(int)response.StatusCode} {body}");
    }
}`,
  rust: `// Cargo.toml: reqwest = { version = "0.12", features = ["json", "multipart"] }
use reqwest::multipart::{Form, Part};
use serde_json::Value;
use std::{env, fs};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // reqwest builds the multipart body and its boundary from the form.
    let form = Form::new()
        .part(
            "file",
            Part::bytes(fs::read("invoice.pdf")?).file_name("invoice.pdf"),
        )
        // args is a JSON string in one field, not a field per argument.
        .text("args", r#"{"format":"markdown"}"#);

    let response = reqwest::Client::new()
        .post("${host}/v1/ocr/TEXT_EXTRACTION")
        .bearer_auth(env::var("HEIRS_API_KEY")?)
        .multipart(form)
        .send()
        .await?;

    let status = response.status();
    let body: Value = response.json().await?;

    if !status.is_success() {
        let error = &body["error"];
        return Err(format!("{}: {} ({})", error["code"], error["message"], error["requestId"]).into());
    }

    // 200 → result inline; 202 → a queued job, see below.
    println!("{status} {}", body["result"]);
    Ok(())
}`,
});

export const CODE_BLOCKS: Record<string, string> = {
  bash: ``,
  typescript: `import crypto from "node:crypto";

// The raw body — parse only after verifying, or the bytes you check
// are not the bytes that were signed.
export function verify(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return false;

  // Reject anything older than the tolerance: the timestamp is inside the
  // signed string, so a captured delivery cannot be replayed later.
  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`,
  python: `import hashlib
import hmac
import time


# The raw body — parse only after verifying, or the bytes you check
# are not the bytes that were signed.
def verify(raw_body: bytes, header: str, secret: str, tolerance_seconds: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    try:
        timestamp = int(parts["t"])
    except (KeyError, ValueError):
        return False

    # Reject anything older than the tolerance: the timestamp is inside the
    # signed string, so a captured delivery cannot be replayed later.
    if abs(int(time.time()) - timestamp) > tolerance_seconds:
        return False

    expected = hmac.new(
        secret.encode(),
        f"{timestamp}.".encode() + raw_body,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, parts.get("v1", ""))`,
  go: `package webhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Verify takes the raw body — parse only after verifying, or the bytes you
// check are not the bytes that were signed.
func Verify(rawBody []byte, header, secret string, tolerance time.Duration) bool {
	parts := map[string]string{}
	for _, piece := range strings.Split(header, ",") {
		if kv := strings.SplitN(piece, "=", 2); len(kv) == 2 {
			parts[kv[0]] = kv[1]
		}
	}

	timestamp, err := strconv.ParseInt(parts["t"], 10, 64)
	if err != nil {
		return false
	}

	// Reject anything older than the tolerance: the timestamp is inside the
	// signed string, so a captured delivery cannot be replayed later.
	age := time.Since(time.Unix(timestamp, 0))
	if age < 0 {
		age = -age
	}
	if age > tolerance {
		return false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(mac, "%d.", timestamp)
	mac.Write(rawBody)
	expected := hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(expected), []byte(parts["v1"]))
}`,
  ruby: `require "openssl"

# The raw body — parse only after verifying, or the bytes you check
# are not the bytes that were signed.
def verify(raw_body, header, secret, tolerance_seconds = 300)
  parts = header.split(",").map { |piece| piece.split("=", 2) }.to_h
  timestamp = Integer(parts["t"].to_s, exception: false)
  return false if timestamp.nil?

  # Reject anything older than the tolerance: the timestamp is inside the
  # signed string, so a captured delivery cannot be replayed later.
  return false if (Time.now.to_i - timestamp).abs > tolerance_seconds

  expected = OpenSSL::HMAC.hexdigest("SHA256", secret, "#{timestamp}.#{raw_body}")

  OpenSSL.secure_compare(expected, parts["v1"].to_s)
end`,
  php: `<?php

// The raw body — parse only after verifying, or the bytes you check
// are not the bytes that were signed.
function verify(string $rawBody, string $header, string $secret, int $toleranceSeconds = 300): bool
{
    $parts = [];
    foreach (explode(',', $header) as $piece) {
        [$key, $value] = array_pad(explode('=', $piece, 2), 2, '');
        $parts[$key] = $value;
    }

    if (!isset($parts['t']) || !ctype_digit($parts['t'])) {
        return false;
    }
    $timestamp = (int) $parts['t'];

    // Reject anything older than the tolerance: the timestamp is inside the
    // signed string, so a captured delivery cannot be replayed later.
    if (abs(time() - $timestamp) > $toleranceSeconds) {
        return false;
    }

    $expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);

    return hash_equals($expected, $parts['v1'] ?? '');
}`,
  java: `import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class WebhookSignature {
  // The raw body — parse only after verifying, or the bytes you check
  // are not the bytes that were signed.
  public static boolean verify(String rawBody, String header, String secret, long toleranceSeconds)
      throws Exception {
    Map<String, String> parts = new HashMap<>();
    for (String piece : header.split(",")) {
      String[] kv = piece.split("=", 2);
      if (kv.length == 2) parts.put(kv[0], kv[1]);
    }

    long timestamp;
    try {
      timestamp = Long.parseLong(parts.getOrDefault("t", ""));
    } catch (NumberFormatException e) {
      return false;
    }

    // Reject anything older than the tolerance: the timestamp is inside the
    // signed string, so a captured delivery cannot be replayed later.
    if (Math.abs(Instant.now().getEpochSecond() - timestamp) > toleranceSeconds) return false;

    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    byte[] digest = mac.doFinal((timestamp + "." + rawBody).getBytes(StandardCharsets.UTF_8));

    StringBuilder expected = new StringBuilder(digest.length * 2);
    for (byte b : digest) expected.append(String.format("%02x", b));

    return MessageDigest.isEqual(
        expected.toString().getBytes(StandardCharsets.UTF_8),
        parts.getOrDefault("v1", "").getBytes(StandardCharsets.UTF_8));
  }
}`,
  csharp: `using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;

public static class WebhookSignature
{
    // The raw body — parse only after verifying, or the bytes you check
    // are not the bytes that were signed.
    public static bool Verify(string rawBody, string header, string secret, int toleranceSeconds = 300)
    {
        var parts = new Dictionary<string, string>();
        foreach (var piece in header.Split(','))
        {
            var kv = piece.Split('=', 2);
            if (kv.Length == 2) parts[kv[0]] = kv[1];
        }

        if (!parts.TryGetValue("t", out var rawTimestamp) || !long.TryParse(rawTimestamp, out var timestamp))
        {
            return false;
        }

        // Reject anything older than the tolerance: the timestamp is inside the
        // signed string, so a captured delivery cannot be replayed later.
        var age = Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - timestamp);
        if (age > toleranceSeconds) return false;

        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var digest = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}.{rawBody}"));
        var expected = Convert.ToHexString(digest).ToLowerInvariant();

        parts.TryGetValue("v1", out var provided);
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(expected),
            Encoding.UTF8.GetBytes(provided ?? string.Empty));
    }
}`,
  rust: `use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha256 = Hmac<Sha256>;

/// Takes the raw body — parse only after verifying, or the bytes you check
/// are not the bytes that were signed.
pub fn verify(raw_body: &[u8], header: &str, secret: &str, tolerance_seconds: i64) -> bool {
    let mut timestamp: Option<i64> = None;
    let mut signature: Option<&str> = None;
    for piece in header.split(',') {
        match piece.split_once('=') {
            Some(("t", value)) => timestamp = value.parse().ok(),
            Some(("v1", value)) => signature = Some(value),
            _ => {}
        }
    }

    let (Some(timestamp), Some(signature)) = (timestamp, signature) else {
        return false;
    };

    // Reject anything older than the tolerance: the timestamp is inside the
    // signed string, so a captured delivery cannot be replayed later.
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before the epoch")
        .as_secs() as i64;
    if (now - timestamp).abs() > tolerance_seconds {
        return false;
    }

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("hmac takes any key length");
    mac.update(format!("{timestamp}.").as_bytes());
    mac.update(raw_body);

    // verify_slice compares in constant time.
    match hex::decode(signature) {
        Ok(provided) => mac.verify_slice(&provided).is_ok(),
        Err(_) => false,
    }
}`,
  javascript: `const crypto = require("node:crypto");

// The raw body — parse only after verifying, or the bytes you check
// are not the bytes that were signed.
function verify(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return false;

  // Reject anything older than the tolerance: the timestamp is inside the
  // signed string, so a captured delivery cannot be replayed later.
  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { verify };`,
};
