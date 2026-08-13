"use client";

import { useState } from "react";
import { DatabaseBackup, Loader, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Archive } from "lucide-react";

import { ConfirmDialog, EmptyState, PageLayout, Skeleton } from "@/components/shared";
import { Button } from "@heirs/ui";
import { Input } from "@heirs/ui";
import { useBackups, useCreateBackup, useRestoreBackup } from "@/hooks/api/use-admin-console";
import { getErrorMessage } from "@heirs/api-client";
import type { BackupManifest } from "@/types/admin-console";

const fmt = (iso: string) => new Date(iso).toLocaleString();
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const summarize = (counts: Record<string, number>) =>
  Object.entries(counts)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");

const Page = () => {
  const backups = useBackups();
  const create = useCreateBackup();
  const restore = useRestoreBackup();
  const [note, setNote] = useState("");
  const [pendingRestore, setPendingRestore] = useState<BackupManifest | null>(null);

  const onCreate = () =>
    create.mutate(note.trim() || undefined, {
      onSuccess: () => {
        toast.success("Backup created");
        setNote("");
      },
      onError: (e) => toast.error(getErrorMessage(e)),
    });

  const onRestore = () => {
    if (!pendingRestore) return;
    const id = pendingRestore.id;
    restore.mutate(id, {
      onSuccess: (r) => {
        const total = Object.values(r.applied).reduce((a, b) => a + b, 0);
        toast.success(`Restored ${total} rows`);
        setPendingRestore(null);
      },
      onError: (e) => toast.error(getErrorMessage(e)),
    });
  };

  return (
    <PageLayout
      title="Backup & Restore"
      subtitle="Snapshot and restore platform configuration — plans, subscriptions, and settings."
    >
      <div className="space-y-6">
        <div className="border-hairline bg-(--surface-strong)/30 rounded-md border px-3 py-2 text-xs text-muted-foreground">
          Scope is the configuration catalog only. Full-database disaster recovery remains a managed-snapshot / pg_dump
          concern outside the app. Restore is additive and idempotent — it never deletes existing rows.
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-sm font-medium">Note (optional)</label>
            <Input placeholder="e.g. before plan migration" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button onClick={onCreate} disabled={create.isPending}>
            {create.isPending ? <Loader className="animate-spin" /> : <DatabaseBackup className="size-4" />}
            Create backup
          </Button>
        </div>

        {backups.isPending && <Skeleton skeleton="table" columns={6} rows={5} />}

        {backups.isError && (
          <div className="border-hairline rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {getErrorMessage(backups.error)}
          </div>
        )}

        {backups.data && backups.data.backups.length === 0 && (
          <EmptyState
            icon={Archive}
            title="No backups yet"
            description="Create a snapshot before risky changes. Each backup captures the current plans, subscriptions, and settings."
          />
        )}

        {backups.data && backups.data.backups.length > 0 && (
          <div className="border-hairline bg-card overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-(--surface-strong)/40 text-left text-xs text-muted-foreground">
                <tr className="border-hairline border-b">
                  <th className="px-3 py-2.5 font-medium">Created</th>
                  <th className="px-3 py-2.5 font-medium">By</th>
                  <th className="px-3 py-2.5 font-medium">Contents</th>
                  <th className="px-3 py-2.5 text-right font-medium">Size</th>
                  <th className="px-3 py-2.5 font-medium">Note</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {backups.data.backups.map((b) => (
                  <tr key={b.id} className="border-hairline hover:bg-accent/40 border-b last:border-0">
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">
                      {fmt(b.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">{b.createdBy}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{summarize(b.counts)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{kb(b.sizeBytes)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{b.note ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Button variant="outline" size="sm" onClick={() => setPendingRestore(b)}>
                        <RotateCcw className="size-3.5" /> Restore
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingRestore}
        title="Restore backup"
        description={
          pendingRestore
            ? `Re-apply the snapshot from ${fmt(pendingRestore.createdAt)}. Existing rows with matching keys will be overwritten.`
            : undefined
        }
        confirmLabel="Restore"
        pending={restore.isPending}
        onConfirm={onRestore}
        onOpenChange={(open) => !open && setPendingRestore(null)}
      />
    </PageLayout>
  );
};

export default Page;
