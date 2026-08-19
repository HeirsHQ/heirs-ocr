import { describe, expect, it } from "vitest";

import { isIpAllowed, matchesEntry, parseIp } from "../src/auth/ip-allowlist";

/**
 * Sign-in IP restrictions. The failure modes here are asymmetric: wrongly allowing
 * is a security hole, wrongly denying locks an operator out of their own console —
 * so both directions are pinned, including the malformed-input cases.
 */

describe("parseIp", () => {
  it("parses IPv4", () => {
    expect(parseIp("203.0.113.4")).toEqual([203, 0, 113, 4]);
  });

  it("normalises IPv4-mapped IPv6 down to IPv4", () => {
    // Node reports this form on a dual-stack listener; an allowlist written as plain
    // IPv4 must still match it, or the control behaves differently per deployment.
    expect(parseIp("::ffff:203.0.113.4")).toEqual([203, 0, 113, 4]);
  });

  it("expands IPv6 shorthand", () => {
    expect(parseIp("::1")).toEqual([...new Array(15).fill(0), 1]);
    expect(parseIp("2001:db8::1")).toEqual([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("rejects malformed input rather than guessing", () => {
    for (const bad of ["", "  ", "1.2.3", "1.2.3.4.5", "256.0.0.1", "1.2.3.x", "2001:db8::1::2", "nonsense"]) {
      expect(parseIp(bad)).toBeUndefined();
    }
  });
});

describe("matchesEntry", () => {
  it("matches a bare address exactly", () => {
    expect(matchesEntry("203.0.113.4", "203.0.113.4")).toBe(true);
    expect(matchesEntry("203.0.113.5", "203.0.113.4")).toBe(false);
  });

  it("matches inside an IPv4 CIDR range and not outside it", () => {
    expect(matchesEntry("203.0.113.42", "203.0.113.0/24")).toBe(true);
    expect(matchesEntry("203.0.113.255", "203.0.113.0/24")).toBe(true);
    expect(matchesEntry("203.0.114.1", "203.0.113.0/24")).toBe(false);
    expect(matchesEntry("10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(matchesEntry("11.1.2.3", "10.0.0.0/8")).toBe(false);
  });

  it("handles prefixes that fall mid-byte", () => {
    // /28 splits the last byte, so this exercises the mask rather than whole bytes.
    expect(matchesEntry("192.168.1.14", "192.168.1.0/28")).toBe(true);
    expect(matchesEntry("192.168.1.16", "192.168.1.0/28")).toBe(false);
  });

  it("matches an IPv4-mapped request against a plain IPv4 rule", () => {
    expect(matchesEntry("::ffff:203.0.113.42", "203.0.113.0/24")).toBe(true);
  });

  it("matches IPv6 ranges", () => {
    expect(matchesEntry("2001:db8::5", "2001:db8::/32")).toBe(true);
    expect(matchesEntry("2001:db9::5", "2001:db8::/32")).toBe(false);
  });

  it("never matches across address families", () => {
    // An IPv4 address is not "inside" an IPv6 range, however the bytes line up.
    expect(matchesEntry("203.0.113.4", "::/0")).toBe(false);
    expect(matchesEntry("2001:db8::1", "0.0.0.0/0")).toBe(false);
  });

  it("treats a malformed entry as matching nothing", () => {
    // Not as "allow everything" — a typo must not disable the control — and not by
    // throwing, which one bad saved row would turn into a total sign-in outage.
    for (const bad of ["", "garbage", "203.0.113.0/33", "203.0.113.0/x", "999.0.0.0/8"]) {
      expect(matchesEntry("203.0.113.4", bad)).toBe(false);
    }
  });
});

describe("isIpAllowed", () => {
  it("allows everything when the list is empty — the unconfigured state", () => {
    expect(isIpAllowed("203.0.113.4", [])).toBe(true);
    // Whitespace-only rows are not rules; a trailing newline in a textarea is common.
    expect(isIpAllowed("203.0.113.4", ["", "   "])).toBe(true);
  });

  it("allows an address matching any one entry", () => {
    expect(isIpAllowed("10.0.0.7", ["203.0.113.0/24", "10.0.0.0/8"])).toBe(true);
  });

  it("denies an address matching none", () => {
    expect(isIpAllowed("198.51.100.1", ["203.0.113.0/24", "10.0.0.0/8"])).toBe(false);
  });

  it("denies when the source address is unknown and a list is configured", () => {
    // Fail closed: an allowlist that cannot see the caller must not wave them through.
    expect(isIpAllowed(undefined, ["203.0.113.0/24"])).toBe(false);
    // ...but an unknown address with no list configured is still fine.
    expect(isIpAllowed(undefined, [])).toBe(true);
  });
});
