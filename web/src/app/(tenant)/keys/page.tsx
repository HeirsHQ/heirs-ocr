"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { KeyRound, Loader, Plus } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog, DataTable, PageLayout, SecretCallout } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCreateTenantKey, useRevokeTenantKey, useTenantKeys } from "@/hooks/api/use-tenant-keys";
import { getErrorMessage } from "@/lib/client";
import { createKeyColumns } from "@/config/columns/keys";
import type { TenantApiKey } from "@/types/user";

const schema = z.object({ name: z.string().trim().max(80, "Keep the name under 80 characters").optional() });
type FormValues = z.infer<typeof schema>;

const CreateKeyModal = () => {
  const [open, setOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const createKey = useCreateTenantKey();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const close = () => {
    setOpen(false);
    setNewKey(null);
    reset({ name: "" });
  };

  const onCreate = handleSubmit(({ name }) => {
    createKey.mutate(
      { name: name || undefined },
      {
        onSuccess: (created) => {
          setNewKey(created.apiKey);
          reset({ name: "" });
        },
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        New key
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent
          title="Create API key"
          description={newKey ? undefined : "Generate a key for programmatic access."}
        >
          {newKey ? (
            <div className="space-y-3">
              <SecretCallout
                value={newKey}
                title="Copy your new API key now"
                note="Only shown once — we keep only a hash."
              />
              <div className="flex justify-end">
                <Button onClick={close}>Done</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={onCreate} className="space-y-3" noValidate>
              <div className="space-y-1">
                <label htmlFor="key-name" className="text-sm font-medium">
                  Label (optional)
                </label>
                <Input id="key-name" placeholder="e.g. CI pipeline" {...register("name")} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={close} disabled={createKey.isPending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createKey.isPending}>
                  {createKey.isPending ? <Loader className="animate-spin" /> : "Generate"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

const Page = () => {
  const keys = useTenantKeys();
  const revokeKey = useRevokeTenantKey();
  const [pendingRevoke, setPendingRevoke] = useState<TenantApiKey | null>(null);

  const confirmRevoke = () => {
    if (!pendingRevoke) return;
    revokeKey.mutate(pendingRevoke.keyHash, {
      onSuccess: () => {
        toast.success("API key revoked");
        setPendingRevoke(null);
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  };

  const columns = useMemo(() => createKeyColumns({ onRevoke: (key) => setPendingRevoke(key) }), []);

  return (
    <PageLayout title="API Keys" subtitle="Programmatic access to the OCR API for your organization.">
      <div className=" space-y-6">
        <CreateKeyModal />

        {keys.isPending && <p className="text-sm text-muted-foreground">Loading keys…</p>}

        {keys.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {getErrorMessage(keys.error)}
          </div>
        )}

        {keys.data && keys.data.keys.length === 0 && (
          <div className="flex flex-col items-center gap-1 rounded-md border border-dashed py-10 text-center">
            <KeyRound className="size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No API keys yet. Generate one above.</p>
          </div>
        )}

        {keys.data && keys.data.keys.length > 0 && (
          <div className="rounded-md border">
            <DataTable columns={columns} data={keys.data.keys} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingRevoke}
        title="Revoke API key"
        description={
          pendingRevoke
            ? `${pendingRevoke.name || "This key"} (${pendingRevoke.prefix}…) will stop working immediately.`
            : undefined
        }
        confirmLabel="Revoke"
        pending={revokeKey.isPending}
        onConfirm={confirmRevoke}
        onOpenChange={(open) => !open && setPendingRevoke(null)}
      />
    </PageLayout>
  );
};

export default Page;
