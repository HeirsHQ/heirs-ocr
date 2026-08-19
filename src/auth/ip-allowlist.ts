/**
 * IP allowlist matching for sign-in restrictions.
 *
 * Hand-rolled rather than pulled from npm: the whole job is parsing an address and
 * comparing a prefix, and an access-control primitive is not worth a supply-chain
 * dependency. Both IPv4 and IPv6 are handled, including the IPv4-mapped form
 * (`::ffff:203.0.113.4`) that Node reports on a dual-stack listener — an allowlist
 * written as `203.0.113.0/24` must still match a request that arrives that way, or
 * the control silently locks everyone out on some deployments and not others.
 *
 * **Where this is enforced:** at sign-in, on both surfaces. That restricts where a
 * session can be *established*, not where an existing one may be used — a session
 * minted from an allowed address keeps working if the holder moves. Enforcing per
 * request would need the policy cached on the hot path; until then the UI copy says
 * "sign-ins" rather than implying more than the control delivers.
 */

/** Parses a dotted-quad IPv4 address to its 4 bytes, or `undefined` if malformed. */
const parseIpv4 = (value: string): number[] | undefined => {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;

  const bytes: number[] = [];
  for (const part of parts) {
    // Reject empty, non-numeric, and out-of-range parts. `Number("")` is 0, and
    // leading zeros are ambiguous enough to be worth refusing outright.
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const n = Number(part);
    if (n > 255) return undefined;
    bytes.push(n);
  }
  return bytes;
};

/**
 * Parses any IP to its raw bytes — 4 for IPv4, 16 for IPv6.
 *
 * An IPv4-mapped IPv6 address is normalised down to its 4 IPv4 bytes so it compares
 * equal to the same address written the ordinary way.
 */
export const parseIp = (value: string): number[] | undefined => {
  const address = value.trim();
  if (!address) return undefined;

  if (!address.includes(":")) return parseIpv4(address);

  // IPv4-mapped / IPv4-compatible: take the trailing dotted quad as plain IPv4.
  const mapped = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return parseIpv4(mapped[1]!);

  // Split on `::` (at most one, per the spec) into leading and trailing groups.
  const halves = address.split("::");
  if (halves.length > 2) return undefined;

  const toGroups = (part: string): number[] | undefined => {
    if (!part) return [];
    const groups: number[] = [];
    for (const chunk of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(chunk)) return undefined;
      const n = parseInt(chunk, 16);
      groups.push((n >> 8) & 0xff, n & 0xff);
    }
    return groups;
  };

  const head = toGroups(halves[0] ?? "");
  const tail = toGroups(halves[1] ?? "");
  if (!head || !tail) return undefined;

  if (halves.length === 1) return head.length === 16 ? head : undefined;

  const gap = 16 - head.length - tail.length;
  if (gap < 0) return undefined;
  return [...head, ...new Array<number>(gap).fill(0), ...tail];
};

/** Compares the first `bits` bits of two equal-length byte arrays. */
const prefixMatches = (a: number[], b: number[], bits: number): boolean => {
  const wholeBytes = Math.floor(bits / 8);
  for (let i = 0; i < wholeBytes; i++) {
    if (a[i] !== b[i]) return false;
  }
  const remaining = bits % 8;
  if (remaining === 0) return true;

  const mask = (0xff << (8 - remaining)) & 0xff;
  return (a[wholeBytes]! & mask) === (b[wholeBytes]! & mask);
};

/**
 * Whether `ip` matches one allowlist entry — a bare address or a CIDR range.
 *
 * A malformed entry never matches. It cannot be treated as "allow everything"
 * (a typo would disable the control) and it must not throw either, or one bad row
 * saved by an operator would break every sign-in.
 */
export const matchesEntry = (ip: string, entry: string): boolean => {
  const address = parseIp(ip);
  if (!address) return false;

  const [rawNetwork, rawBits] = entry.trim().split("/");
  const network = parseIp(rawNetwork ?? "");
  if (!network) return false;

  // Families must agree: an IPv4 address is not inside an IPv6 range.
  if (network.length !== address.length) return false;

  const maxBits = network.length * 8;
  if (rawBits === undefined) return prefixMatches(address, network, maxBits);

  if (!/^\d{1,3}$/.test(rawBits)) return false;
  const bits = Number(rawBits);
  if (bits > maxBits) return false;

  return prefixMatches(address, network, bits);
};

/**
 * Whether a request from `ip` is permitted by `allowlist`.
 *
 * **An empty list allows everything.** That is the unconfigured state, and it is
 * what makes the feature opt-in rather than a way to lock yourself out by saving an
 * empty form. Entries that are only whitespace are ignored, so a trailing newline in
 * a textarea does not count as a rule.
 */
export const isIpAllowed = (ip: string | undefined, allowlist: readonly string[]): boolean => {
  const entries = allowlist.map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) return true;
  if (!ip) return false;

  return entries.some((entry) => matchesEntry(ip, entry));
};
