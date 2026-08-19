import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Object storage for archived documents (src/storage/blob.ts) against a stub S3
 * client, plus the audit-label helpers (src/observability/audit-labels.ts).
 *
 * The S3 client is stubbed rather than run against MinIO so the suite stays
 * self-contained; what is being pinned here is our own behaviour around the SDK —
 * the opt-in gate, key construction, filename sanitising, and the promise that a
 * storage failure never propagates to the caller.
 */
const { sent, stubClient } = vi.hoisted(() => {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const failNext: { value: Error | undefined } = { value: undefined };

  const stubClient = {
    send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input });
      if (failNext.value) {
        const err = failNext.value;
        failNext.value = undefined;
        throw err;
      }
      return { Errors: [] };
    }),
    failNext,
  };

  return { sent, stubClient };
});

vi.mock("../src/observability/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({}) },
}));

import { actionLabel, personLabel, tenantLabel } from "../src/observability/audit-labels";
import { blobStorageEnabled, deleteDocuments, documentKey, putDocument, setBlobClient } from "../src/storage/blob";
import { env } from "../src/config/env";

/** Flips the opt-in flag for one test. `env` is a plain validated object. */
const withStorage = (enabled: boolean) => {
  (env as unknown as Record<string, unknown>).BLOB_STORAGE_ENABLED = enabled ? "true" : "false";
};

beforeEach(() => {
  sent.length = 0;
  stubClient.send.mockClear();
  stubClient.failNext.value = undefined;
  setBlobClient(stubClient as never);
  withStorage(true);
});

// ── The opt-in gate ───────────────────────────────────────────────────────────

describe("blob storage — opt-in", () => {
  it("does nothing at all when storage is switched off", async () => {
    withStorage(false);
    expect(blobStorageEnabled()).toBe(false);

    // Keeping the source file is a different privacy posture from the metadata-only
    // registry, so it must never happen by default.
    expect(await putDocument({ tenantId: "acme", fileName: "a.pdf", body: Buffer.from("x") })).toBeUndefined();
    expect(await deleteDocuments(["some/key"])).toBe(0);
    expect(stubClient.send).not.toHaveBeenCalled();
  });
});

// ── Keys ──────────────────────────────────────────────────────────────────────

describe("blob storage — keys", () => {
  it("partitions by tenant and day, and makes the random segment carry uniqueness", () => {
    const a = documentKey("acme", "invoice.pdf");
    const b = documentKey("acme", "invoice.pdf");

    expect(a).toMatch(/^documents\/acme\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\/invoice\.pdf$/);
    // Same tenant, same day, same filename — the keys must still differ.
    expect(a).not.toBe(b);
  });

  it("cannot be walked out of its prefix by a hostile filename", () => {
    const key = documentKey("acme", "../../../../etc/passwd");
    expect(key).not.toContain("..");
    expect(key.startsWith("documents/acme/")).toBe(true);
    // The traversal segments are stripped, leaving only the basename.
    expect(key.endsWith("/passwd")).toBe(true);
  });

  it("escapes a tenant id that would otherwise add path segments", () => {
    expect(documentKey("a/b", "x.pdf").startsWith("documents/a%2Fb/")).toBe(true);
  });

  it("keeps keys bounded regardless of filename length", () => {
    const key = documentKey("acme", `${"n".repeat(500)}.pdf`);
    expect(key.split("/").pop()!.length).toBeLessThanOrEqual(120);
  });
});

// ── Upload ────────────────────────────────────────────────────────────────────

describe("blob storage — upload", () => {
  it("uploads with the sniffed content type and returns the key", async () => {
    const key = await putDocument({
      tenantId: "acme",
      fileName: "invoice.pdf",
      body: Buffer.from("hello"),
      contentType: "application/pdf",
    });

    expect(key).toBeDefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.name).toBe("PutObjectCommand");
    expect(sent[0]!.input).toMatchObject({ Key: key, ContentType: "application/pdf" });
  });

  it("falls back to a generic content type when the mime is unknown", async () => {
    await putDocument({ tenantId: "acme", fileName: "x", body: Buffer.from("y") });
    expect(sent[0]!.input.ContentType).toBe("application/octet-stream");
  });

  it("returns undefined instead of throwing when the store rejects", async () => {
    stubClient.failNext.value = new Error("bucket on fire");

    // The OCR request this belongs to has already succeeded; losing the archived
    // copy must not turn that into an error the caller sees.
    await expect(putDocument({ tenantId: "acme", fileName: "a.pdf", body: Buffer.from("x") })).resolves.toBeUndefined();
  });
});

// ── Deletion (retention) ──────────────────────────────────────────────────────

describe("blob storage — deletion", () => {
  it("deletes a batch and reports how many went", async () => {
    expect(await deleteDocuments(["k1", "k2", "k3"])).toBe(3);
    expect(sent[0]!.name).toBe("DeleteObjectsCommand");
    expect(sent[0]!.input.Delete).toMatchObject({ Objects: [{ Key: "k1" }, { Key: "k2" }, { Key: "k3" }] });
  });

  it("no-ops on an empty key list without calling the store", async () => {
    expect(await deleteDocuments([])).toBe(0);
    expect(stubClient.send).not.toHaveBeenCalled();
  });

  it("chunks past the 1000-key limit S3 imposes on one call", async () => {
    const keys = Array.from({ length: 2500 }, (_, i) => `k${i}`);
    expect(await deleteDocuments(keys)).toBe(2500);
    expect(sent).toHaveLength(3);
    expect((sent[0]!.input.Delete as { Objects: unknown[] }).Objects).toHaveLength(1000);
    expect((sent[2]!.input.Delete as { Objects: unknown[] }).Objects).toHaveLength(500);
  });

  it("survives a failed batch rather than aborting the sweep", async () => {
    stubClient.failNext.value = new Error("network");
    // The retention sweep must finish; orphaned objects are a lifecycle-rule problem,
    // a half-run sweep is a correctness one.
    expect(await deleteDocuments(["a", "b"])).toBe(0);
  });
});

// ── Audit labels ──────────────────────────────────────────────────────────────

describe("audit labels", () => {
  it("renders known actions as sentences", () => {
    expect(actionLabel("tenant.revoked")).toBe("Revoked a tenant API key");
    expect(actionLabel("settings.retention.updated")).toBe("Updated retention policy");
  });

  it("humanises an unregistered action rather than leaking the raw key", () => {
    // Forgetting to register a label should degrade the wording, not the UI.
    expect(actionLabel("widget.frobnicated")).toBe("Widget frobnicated");
    expect(actionLabel("a.b_c")).toBe("A b c");
  });

  it("formats a person as name + email, falling back to whichever exists", () => {
    expect(personLabel({ name: "Ada Obi", email: "ada@x.com" })).toBe("Ada Obi (ada@x.com)");
    expect(personLabel({ name: "  ", email: "ada@x.com" })).toBe("ada@x.com");
    expect(personLabel({ name: "Ada Obi", email: null })).toBe("Ada Obi");
    expect(personLabel({})).toBeUndefined();
  });

  it("formats a tenant as name + id, or the bare id when unnamed", () => {
    expect(tenantLabel({ name: "Acme Corp", tenantId: "acme" })).toBe("Acme Corp (acme)");
    expect(tenantLabel({ tenantId: "acme" })).toBe("acme");
    expect(tenantLabel({ name: "   ", tenantId: "acme" })).toBe("acme");
  });
});
