import { listDocumentsPage } from "../observability/documents";
import { listTenantUsers } from "../auth/tenant-users";
import { listKeysForTenant } from "../auth/tenants";
import { logger } from "../observability/logger";

/**
 * A tenant's own data, packaged for download.
 *
 * **This is an export, not a restorable backup — and the difference is not a
 * shortcut.** Two of the three sections are deliberately unrecoverable by design:
 *
 *  - **API keys** are stored as sha256 of the raw key, which is shown once at
 *    creation and never again (src/auth/tenants.ts). A backup can therefore carry the
 *    hash, the display prefix and the metadata, but nothing that authenticates.
 *  - **Team members** are stored with argon2id password hashes. Those are credential
 *    material; writing them into a file a browser downloads would hand an attacker an
 *    offline cracking target for every account in the org. They are omitted entirely.
 *
 * So restoring this file would produce keys that do not work and users who cannot log
 * in. Rather than ship a "restore" that silently cannot restore the parts that matter,
 * this is offered as a record/portability export and says so. Source documents are not
 * included either — they can be large, and each is individually downloadable from the
 * Documents page.
 *
 * The admin-side {@link import("./backups").createBackup} is a different thing: it
 * snapshots the platform *configuration* catalog, which contains no credentials and
 * genuinely can be restored.
 */

/** Documents included before the export is truncated. */
const MAX_DOCUMENTS = 50_000;

export type TenantExport = {
  /** Bumped if the shape changes, so a consumer can tell which layout it holds. */
  version: 1;
  tenantId: string;
  generatedAt: string;
  counts: { documents: number; keys: number; team: number };
  /**
   * True when the document history exceeded {@link MAX_DOCUMENTS} and was cut. The
   * flag exists so a short file is never mistaken for a complete one.
   */
  truncated: boolean;
  /** What this file deliberately does not contain, restated inside the file itself. */
  excluded: string[];
  documents: unknown[];
  keys: unknown[];
  team: unknown[];
};

/** Counts only — what the page shows before anyone downloads anything. */
export type TenantExportSummary = {
  counts: { documents: number; keys: number; team: number };
  excluded: string[];
};

const EXCLUDED = [
  "API key secrets (only a sha256 hash is stored; the raw key is shown once at creation)",
  "Team member passwords (argon2 hashes are credential material and are never exported)",
  "Source document files (download individually from Documents)",
];

const gather = async (tenantId: string, limit: number) => {
  const [documents, keys, team] = await Promise.all([
    listDocumentsPage({ tenantId, page: 1, pageSize: limit }),
    listKeysForTenant(tenantId),
    listTenantUsers(tenantId),
  ]);
  return { documents, keys, team };
};

export const getTenantExportSummary = async (tenantId: string): Promise<TenantExportSummary> => {
  const { documents, keys, team } = await gather(tenantId, 1);
  return {
    counts: { documents: documents.total, keys: keys.length, team: team.length },
    excluded: EXCLUDED,
  };
};

export const buildTenantExport = async (tenantId: string): Promise<TenantExport> => {
  const { documents, keys, team } = await gather(tenantId, MAX_DOCUMENTS);

  logger.info("tenant.export.built", {
    tenantId,
    documents: documents.items.length,
    keys: keys.length,
    team: team.length,
  });

  return {
    version: 1,
    tenantId,
    generatedAt: new Date().toISOString(),
    counts: { documents: documents.total, keys: keys.length, team: team.length },
    truncated: documents.total > documents.items.length,
    excluded: EXCLUDED,
    documents: documents.items,
    // Each key contributes its hash and settings — never anything usable to sign a
    // request. `keyHash` is the same identifier the portal already displays.
    keys: keys.map(({ keyHash, tenant }) => ({
      keyHash,
      name: tenant.name ?? null,
      disabled: tenant.disabled ?? false,
      rateLimit: tenant.rateLimit ?? null,
      allowedFunctions: tenant.allowedFunctions ?? null,
      allowedOrigins: tenant.allowedOrigins ?? null,
      expiresAt: tenant.expiresAt ?? null,
      createdAt: tenant.createdAt,
    })),
    // `listTenantUsers` returns the public view, which already strips the password
    // hash — the omission is enforced by the store, not by remembering it here.
    team,
  };
};
