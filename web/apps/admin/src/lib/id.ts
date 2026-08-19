/**
 * Client-side id generation for draft rows the operator adds before saving.
 *
 * `crypto.randomUUID()` is exposed **only in a secure context** — HTTPS, or
 * `localhost`/`127.0.0.1`. Served over plain HTTP on any other host (an internal IP,
 * a LAN hostname) it is `undefined`, and calling it throws inside the click handler:
 * the row is never appended, no toast fires, and the "Add" button reads as dead.
 * The console is expected to run over plain HTTP in non-local deployments — the
 * session-cookie note in `src/http/admin/routes.ts` is built around exactly that — so
 * the secure-context assumption cannot be made here.
 *
 * `crypto.getRandomValues` carries no such restriction, so the fallback is still a
 * real random v4 rather than a counter. The last resort covers a context with no web
 * crypto at all; these ids only have to be unique within one unsaved form.
 */
export const randomId = (): string => {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

    if (typeof crypto.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      // Version (4) and variant (10xx) bits, per RFC 4122.
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
