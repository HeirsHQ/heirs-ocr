"use client";

import { DatabaseBackup, Loader } from "lucide-react";
import { Archive } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog, EmptyState, ErrorState, PageLayout, Skeleton } from "@/components/shared";
import { useBackups, useCreateBackup, useRestoreBackup } from "@/hooks/api/use-admin-console";
import { createBackupColumns } from "@/config/columns/backup";
import type { BackupManifest } from "@/types/admin-console";
import { getErrorMessage } from "@heirs/api-client";
import { DataTable, Label } from "@heirs/ui";
import { Button } from "@heirs/ui";
import { Input } from "@heirs/ui";
import { usePagination } from "@heirs/ui";

const fmt = (iso: string) => new Date(iso).toLocaleString();

const Page = () => {
  const { params, tableProps } = usePagination();
  const backups = useBackups(params);
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

  const columns = createBackupColumns({
    onRestore: (backup) => setPendingRestore(backup),
    onView: () => {},
  });

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
            <Label>Note (optional)</Label>
            <Input placeholder="e.g. before plan migration" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button onClick={onCreate} disabled={create.isPending}>
            {create.isPending ? <Loader className="animate-spin" /> : <DatabaseBackup className="size-4" />}
            Create backup
          </Button>
        </div>
        {backups.isPending ? (
          <Skeleton skeleton="table" columns={6} rows={5} />
        ) : backups && backups.isError ? (
          <ErrorState
            title="Couldn't load backups"
            description={getErrorMessage(backups.error)}
            onRetry={() => backups.refetch()}
            retrying={backups.isFetching}
          />
        ) : backups.data && backups.data.items.length === 0 ? (
          <EmptyState
            icon={Archive}
            title="No backups yet"
            description="Create a snapshot before risky changes. Each backup captures the current plans, subscriptions, and settings."
          />
        ) : (
          <DataTable
            columns={columns}
            data={backups.data?.items ?? []}
            total={backups.data?.total ?? 0}
            {...tableProps}
          />
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
