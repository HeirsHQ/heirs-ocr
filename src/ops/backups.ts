import { randomUUID } from "node:crypto";

import { logger } from "../observability/logger";
import { query } from "../db";

/**
 * In-app configuration backup & restore, backed by the `backups` table
 * (src/db.ts). Scope is the platform *configuration catalog* — plans,
 * subscriptions, and platform settings — the durable, operator-managed state that
 * is safe to snapshot and re-apply idempotently. It is deliberately **not** a full
 * database backup: credential tables (admins, tenant API-key hashes) are excluded,
 * and disaster-recovery of the whole cluster remains a pg_dump / managed-snapshot
 * concern outside the app (see docs/runbook.md).
 *
 * A backup captures a JSON snapshot plus a manifest (row counts, size, actor).
 * Restore upserts each captured row back — additive and idempotent; it never drops
 * rows that exist now but weren't in the snapshot.
 */

const TABLES = ["plans", "subscriptions", "platform_settings"] as const;
type BackupTable = (typeof TABLES)[number];

type Snapshot = Record<BackupTable, Record<string, unknown>[]>;

export type BackupManifest = {
  id: string;
  createdAt: string;
  createdBy: string;
  note: string | null;
  counts: Record<string, number>;
  sizeBytes: number;
};

type BackupRow = {
  id: string;
  created_at: Date;
  created_by: string;
  note: string | null;
  counts: unknown;
  size_bytes: number;
};

type BackupDataRow = BackupRow & { data: unknown };

const toManifest = (r: BackupRow): BackupManifest => ({
  id: r.id,
  createdAt: r.created_at.toISOString(),
  createdBy: r.created_by,
  note: r.note,
  counts: (r.counts as Record<string, number>) ?? {},
  sizeBytes: r.size_bytes,
});

/** Read every backup-scope table into an in-memory snapshot. */
const captureSnapshot = async (): Promise<Snapshot> => {
  const snapshot = {} as Snapshot;
  for (const table of TABLES) {
    const { rows } = await query(`SELECT * FROM ${table}`);
    snapshot[table] = rows;
  }
  return snapshot;
};

/** Create a configuration backup; returns its manifest. */
export const createBackup = async (input: { actor: string; note?: string }): Promise<BackupManifest> => {
  const snapshot = await captureSnapshot();
  const counts = Object.fromEntries(TABLES.map((t) => [t, snapshot[t].length]));
  const payload = JSON.stringify(snapshot);
  const id = randomUUID();
  const { rows } = await query<BackupRow>(
    `INSERT INTO backups (id, created_by, note, counts, size_bytes, data)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)
     RETURNING id, created_at, created_by, note, counts, size_bytes`,
    [id, input.actor, input.note ?? null, JSON.stringify(counts), Buffer.byteLength(payload), payload],
  );
  logger.info("backup.created", { backupId: id, actor: input.actor, counts });
  return toManifest(rows[0]!);
};

/** Most-recent-first backup manifests (no payload). */
export const listBackups = async (): Promise<BackupManifest[]> => {
  const { rows } = await query<BackupRow>(
    `SELECT id, created_at, created_by, note, counts, size_bytes
       FROM backups ORDER BY created_at DESC LIMIT 100`,
  );
  return rows.map(toManifest);
};

/** One backup with its full snapshot payload, or `undefined`. */
export const getBackup = async (id: string): Promise<{ manifest: BackupManifest; data: Snapshot } | undefined> => {
  const { rows } = await query<BackupDataRow>(`SELECT * FROM backups WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) return undefined;
  return { manifest: toManifest(row), data: row.data as Snapshot };
};

/**
 * Restore a backup by upserting each captured row back into its table. Additive
 * and idempotent — existing rows with matching primary keys are overwritten;
 * nothing is deleted. Returns per-table counts of rows applied.
 */
export const restoreBackup = async (id: string): Promise<Record<string, number> | undefined> => {
  const backup = await getBackup(id);
  if (!backup) return undefined;
  const applied: Record<string, number> = {};

  for (const row of backup.data.plans ?? []) {
    const p = row as { id: string; tier: string; hidden: boolean; data: unknown };
    await query(
      `INSERT INTO plans (id, tier, hidden, data, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET tier = excluded.tier, hidden = excluded.hidden,
         data = excluded.data, updated_at = now()`,
      [p.id, p.tier, p.hidden, JSON.stringify(p.data)],
    );
  }
  applied.plans = (backup.data.plans ?? []).length;

  for (const row of backup.data.subscriptions ?? []) {
    const s = row as { tenant_id: string; plan_id: string; status: string; data: unknown };
    await query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, data, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (tenant_id) DO UPDATE SET plan_id = excluded.plan_id, status = excluded.status,
         data = excluded.data, updated_at = now()`,
      [s.tenant_id, s.plan_id, s.status, JSON.stringify(s.data)],
    );
  }
  applied.subscriptions = (backup.data.subscriptions ?? []).length;

  for (const row of backup.data.platform_settings ?? []) {
    const p = row as { namespace: string; data: unknown };
    await query(
      `INSERT INTO platform_settings (namespace, data, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (namespace) DO UPDATE SET data = excluded.data, updated_at = now()`,
      [p.namespace, JSON.stringify(p.data)],
    );
  }
  applied.platform_settings = (backup.data.platform_settings ?? []).length;

  logger.info("backup.restored", { backupId: id, applied });
  return applied;
};
