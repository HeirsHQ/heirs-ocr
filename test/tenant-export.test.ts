import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The tenant data export.
 *
 * The load-bearing assertions are about what is *absent*: this file is downloaded to
 * a laptop, so a leaked API key secret or an argon2 password hash in it would be a
 * credential disclosure for the whole org.
 */
const { query, resetDb } = vi.hoisted(() => {
  const { newDb } = require("pg-mem") as typeof import("pg-mem");

  const DDL = `
    CREATE TABLE IF NOT EXISTS tenants (
      key_hash text PRIMARY KEY,
      tenant_id text NOT NULL,
      name text,
      disabled boolean NOT NULL DEFAULT false,
      rate_limit integer,
      allowed_origins jsonb,
      allowed_functions jsonb,
      expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tenant_users (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL,
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      role text NOT NULL,
      password_hash text NOT NULL,
      disabled boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL,
      function_key text NOT NULL,
      file_name text NOT NULL,
      byte_size bigint NOT NULL DEFAULT 0,
      page_count integer NOT NULL DEFAULT 0,
      outcome text NOT NULL,
      provider text,
      tokens_used bigint,
      duration_ms integer,
      created_at timestamptz NOT NULL DEFAULT now(),
      storage_key text
    );
  `;

  let mem = newDb();
  let pool = new (mem.adapters.createPg().Pool)();
  const query = vi.fn((text: string, params?: unknown[]) => pool.query(text, params));
  const resetDb = async () => {
    mem = newDb();
    pool = new (mem.adapters.createPg().Pool)();
    mem.public.none(DDL);
    query.mockReset();
    query.mockImplementation((text: string, params?: unknown[]) => pool.query(text, params));
  };
  return { query, resetDb };
});

vi.mock("../src/db", () => ({
  query,
  ensureSchema: async () => {},
  whenDbReady: async () => {},
  closeDb: async () => {},
}));

import { buildTenantExport, getTenantExportSummary } from "../src/ops/tenant-export";
import { generateApiKey, hashApiKey, putTenant } from "../src/auth/tenants";
import { createTenantUser } from "../src/auth/tenant-users";
import { recordDocument } from "../src/observability/documents";

beforeEach(resetDb);

const seed = async (tenantId = "acme") => {
  const apiKey = generateApiKey();
  await putTenant(apiKey, { tenantId, name: "Acme Corp", createdAt: new Date().toISOString() });
  const user = await createTenantUser({
    tenantId,
    email: `owner@${tenantId}.com`,
    name: "Ada Obi",
    role: "owner",
    password: "secret12345",
  });
  await recordDocument({
    tenantId,
    functionKey: "TEXT_EXTRACTION",
    sensitivity: "standard",
    fileName: "invoice.pdf",
    byteSize: 2048,
    pageCount: 3,
    outcome: "success",
  });
  return { apiKey, user };
};

describe("tenant export — contents", () => {
  it("includes documents, keys and team with their metadata", async () => {
    await seed();
    const exported = await buildTenantExport("acme");

    expect(exported.counts).toEqual({ documents: 1, keys: 1, team: 1 });
    expect(exported.documents[0]).toMatchObject({ fileName: "invoice.pdf", pageCount: 3 });
    expect(exported.keys[0]).toMatchObject({ name: "Acme Corp", disabled: false });
    expect(exported.team[0]).toMatchObject({ email: "owner@acme.com", role: "owner" });
    expect(exported.version).toBe(1);
  });

  it("scopes everything to the asking org", async () => {
    await seed("acme");
    await seed("other");

    const exported = await buildTenantExport("acme");
    expect(exported.counts).toEqual({ documents: 1, keys: 1, team: 1 });
    expect(JSON.stringify(exported)).not.toContain("other");
  });

  it("summarises without building the whole payload", async () => {
    await seed();
    const summary = await getTenantExportSummary("acme");
    expect(summary.counts).toEqual({ documents: 1, keys: 1, team: 1 });
    expect(summary.excluded.length).toBeGreaterThan(0);
  });

  it("is empty rather than failing for an org with nothing in it", async () => {
    const exported = await buildTenantExport("brand-new");
    expect(exported.counts).toEqual({ documents: 0, keys: 0, team: 0 });
    expect(exported.truncated).toBe(false);
  });
});

// ── The part that matters ─────────────────────────────────────────────────────

describe("tenant export — credential material is absent", () => {
  it("carries no usable API key, only its hash", async () => {
    const { apiKey } = await seed();
    const serialized = JSON.stringify(await buildTenantExport("acme"));

    // The raw key is shown once at creation and never stored, so it cannot leak here
    // — but assert it explicitly, because this file lands on someone's laptop.
    expect(serialized).not.toContain(apiKey);
    // The hash is fine: it identifies the key without authenticating anything.
    expect(serialized).toContain(hashApiKey(apiKey));
  });

  it("carries no password hash for any team member", async () => {
    await seed();
    const exported = await buildTenantExport("acme");

    // An argon2 hash in a downloadable file is an offline cracking target for every
    // account in the org.
    expect(JSON.stringify(exported)).not.toContain("$argon2");
    expect(exported.team[0]).not.toHaveProperty("passwordHash");
  });

  it("states inside the file what it deliberately leaves out", async () => {
    const exported = await buildTenantExport("acme");
    // So a reader of the file — not just of the UI — knows it is not restorable.
    expect(exported.excluded.join(" ")).toMatch(/API key secrets/i);
    expect(exported.excluded.join(" ")).toMatch(/passwords/i);
    expect(exported.excluded.join(" ")).toMatch(/Source document files/i);
  });

  it("flags a truncated document history rather than looking complete", async () => {
    await seed();
    const exported = await buildTenantExport("acme");
    // With one document nothing is cut; the flag exists so a short file is never
    // mistaken for a full one when it is.
    expect(exported.truncated).toBe(false);
    expect(exported).toHaveProperty("truncated");
  });
});
