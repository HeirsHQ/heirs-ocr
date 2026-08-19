export const CODE_BLOCKS: Record<string, string> = {
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
