"use client";

import { useState } from "react";
import { Loader, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageLayout, Skeleton } from "@/components/shared";
import { Button } from "@heirs/ui";
import { Checkbox } from "@heirs/ui";
import { Input } from "@heirs/ui";
import { usePlatformSettings, useSavePlatformSettings } from "@/hooks/api/use-admin-console";
import { getErrorMessage } from "@heirs/api-client";
import type { PlatformSettings } from "@/types/admin-console";

const Page = () => {
  const query = usePlatformSettings();
  const save = useSavePlatformSettings();
  const [draft, setDraft] = useState<PlatformSettings | null>(null);
  const [flagKey, setFlagKey] = useState("");
  const [synced, setSynced] = useState<PlatformSettings | null>(null);
  if (query.data && query.data.settings !== synced) {
    setSynced(query.data.settings);
    setDraft(query.data.settings);
  }

  if (query.isError)
    return (
      <PageLayout title="Platform Configuration">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {getErrorMessage(query.error)}
        </div>
      </PageLayout>
    );

  if (!draft)
    return (
      <PageLayout title="Platform Configuration" subtitle="Global defaults, maintenance mode, and feature flags.">
        <Skeleton skeleton="profile" />
      </PageLayout>
    );

  const addFlag = () => {
    const key = flagKey.trim();
    if (!key || key in draft.featureFlags) return;
    setDraft({ ...draft, featureFlags: { ...draft.featureFlags, [key]: false } });
    setFlagKey("");
  };

  const removeFlag = (key: string) => {
    const next = { ...draft.featureFlags };
    delete next[key];
    setDraft({ ...draft, featureFlags: next });
  };

  const onSave = () =>
    save.mutate(draft, {
      onSuccess: () => toast.success("Platform configuration saved"),
      onError: (e) => toast.error(getErrorMessage(e)),
    });

  return (
    <PageLayout title="Platform Configuration" subtitle="Global defaults, maintenance mode, and feature flags.">
      <div className=" space-y-6">
        <label className="flex items-center gap-3 rounded-md border px-3 py-3 text-sm">
          <Checkbox
            checked={draft.maintenanceMode}
            onCheckedChange={(v) => setDraft({ ...draft, maintenanceMode: !!v })}
          />
          <span>
            <span className="font-medium">Maintenance mode</span>
            <span className="block text-xs text-muted-foreground">Surface a maintenance banner / pause intake.</span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Default tenant rate limit (req/min)</label>
            <Input
              type="number"
              min={1}
              value={draft.defaultTenantRateLimit}
              onChange={(e) => setDraft({ ...draft, defaultTenantRateLimit: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Support email</label>
            <Input
              type="email"
              placeholder="support@acme.com"
              value={draft.supportEmail}
              onChange={(e) => setDraft({ ...draft, supportEmail: e.target.value })}
            />
          </div>
        </div>

        <section className="space-y-2">
          <p className="text-sm font-medium">Feature flags</p>
          {Object.keys(draft.featureFlags).length === 0 && (
            <p className="text-sm text-muted-foreground">No feature flags defined.</p>
          )}
          <ul className="space-y-1.5">
            {Object.entries(draft.featureFlags).map(([key, on]) => (
              <li key={key} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <span className="flex-1 truncate font-mono text-xs">{key}</span>
                <Checkbox
                  checked={on}
                  onCheckedChange={(v) => setDraft({ ...draft, featureFlags: { ...draft.featureFlags, [key]: !!v } })}
                />
                <Button variant="ghost" size="icon" onClick={() => removeFlag(key)}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input placeholder="new_flag_key" value={flagKey} onChange={(e) => setFlagKey(e.target.value)} />
            <Button variant="outline" onClick={addFlag}>
              <Plus className="size-4" /> Add flag
            </Button>
          </div>
        </section>

        <Button onClick={onSave} disabled={save.isPending}>
          {save.isPending ? <Loader className="animate-spin" /> : "Save changes"}
        </Button>
      </div>
    </PageLayout>
  );
};

export default Page;
