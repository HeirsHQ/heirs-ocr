import { lookup } from "dns/promises";
import { isIP } from "net";

import { env } from "../config/env";

/**
 * Destination guard for outbound webhooks.
 *
 * A webhook URL is attacker-chosen input that this service then fetches with its own
 * network position. Without a check on where it points, `POST /tenant/api/webhooks`
 * is a server-side request primitive: any tenant owner could aim it at the cloud
 * metadata endpoint (169.254.169.254), a Redis or Postgres host on the private
 * network, or localhost, and read the response status back out of the delivery log.
 * `redirect: "manual"` in the delivery worker closes the redirect-based version of
 * the same trick; this closes the direct one.
 *
 * The check runs **twice**, and that is the point: a hostname that resolved to a
 * public address at registration can be re-pointed at an internal one afterwards
 * (DNS rebinding), so passing once is not a durable answer. Registration rejects the
 * obvious cases loudly; delivery re-resolves and refuses to send.
 *
 * Enforced in production only, matching the https rule in the tenant routes and for
 * the same reason: development receivers are `http://localhost:…`, and a guard that
 * made local testing impossible would just be turned off.
 */

export class UnsafeWebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeWebhookUrlError";
  }
}

const enforced = (): boolean => env.NODE_ENV === "production";

/**
 * Hostnames that resolve somewhere different — and more privileged — on the host
 * running the worker than they do anywhere else. Refused without a lookup.
 */
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain"];

const isBlockedV4 = (ip: string): boolean => {
  const parts = ip.split(".").map(Number);
  // Unparseable is refused rather than allowed: a guard that fails open on input it
  // did not understand is not a guard.
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8 — "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local — includes cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC6598)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking (RFC2544)
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
};

const isBlockedV6 = (raw: string): boolean => {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, "");
  // An IPv4-mapped address is an IPv4 address wearing a hat — judge the address it
  // actually reaches, or ::ffff:127.0.0.1 walks straight past the v6 rules below.
  const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isBlockedV4(mapped[1]!);

  if (ip === "::" || ip === "::1") return true; // unspecified, loopback
  if (/^f[cd]/.test(ip)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(ip)) return true; // fe80::/10 link-local
  if (/^ff/.test(ip)) return true; // ff00::/8 multicast
  return false;
};

/** Whether an IP literal is one this service must never be aimed at. */
export const isBlockedAddress = (ip: string): boolean => {
  const version = isIP(ip);
  if (version === 6) return isBlockedV6(ip);
  if (version === 4) return isBlockedV4(ip);
  return true; // not an IP at all — refuse rather than guess
};

/**
 * Throws {@link UnsafeWebhookUrlError} if `raw` points anywhere this service should
 * not reach. Resolves silently when the destination looks externally routable.
 *
 * A hostname that **fails to resolve** is deliberately allowed through: a receiver
 * whose DNS is briefly down, or whose record does not exist yet at registration
 * time, is a normal condition, and the delivery worker's ordinary retry/timeout path
 * handles it far better than a permanent rejection would. Only a name that resolves
 * *to a blocked address* is refused.
 */
export const assertSafeWebhookUrl = async (raw: string): Promise<void> => {
  if (!enforced()) return;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeWebhookUrlError("Webhook URL could not be parsed");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new UnsafeWebhookUrlError(`Webhook URLs may not point at ${host} — it is not a public address`);
    }
    return;
  }

  if (host === "localhost" || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new UnsafeWebhookUrlError(`Webhook URLs may not point at ${host}`);
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    // See the note above: unresolvable is not the same as unsafe.
    return;
  }

  const blocked = addresses.find((entry) => isBlockedAddress(entry.address));
  if (blocked) {
    throw new UnsafeWebhookUrlError(`${host} resolves to ${blocked.address}, which is not a public address`);
  }
};
