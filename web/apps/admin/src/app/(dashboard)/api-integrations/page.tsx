"use client";

import { Loader, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useApiIntegrations, useSaveApiIntegrations } from "@/hooks/api/use-admin-console";
import type { ApiIntegrationSettings } from "@/types/admin-console";
import { PageLayout, SelectOption, Skeleton } from "@/components/shared";
import { Checkbox } from "@heirs/ui";
import { Button } from "@heirs/ui";
import { getErrorMessage } from "@heirs/api-client";
import { Input } from "@heirs/ui";
import { useValues } from "@/hooks";

const OPTIONS = [
  { label: "Webhook", value: "webhook" },
  { label: "S3", value: "s3" },
];

const Page = () => {
  const { onValueChange, values } = useValues({ kind: "", name: "", url: "" });
  const [synced, setSynced] = useState<ApiIntegrationSettings | null>(null);
  const [draft, setDraft] = useState<ApiIntegrationSettings | null>(null);

  const query = useApiIntegrations();
  const save = useSaveApiIntegrations();
  if (query.data && query.data.settings !== synced) {
    setSynced(query.data.settings);
    setDraft(query.data.settings);
  }

  if (query.isError)
    return (
      <PageLayout title="API Integrations">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {getErrorMessage(query.error)}
        </div>
      </PageLayout>
    );

  if (!draft)
    return (
      <PageLayout title="API Integrations" subtitle="Outbound endpoints the platform can push events to.">
        <Skeleton skeleton="profile" />
      </PageLayout>
    );

  const add = () => {
    const { kind, name, url } = values;
    if (!name.trim() || !url.trim()) return;
    setDraft({
      ...draft,
      integrations: [
        ...draft.integrations,
        {
          id: crypto.randomUUID(),
          name: name.trim(),
          kind,
          url: url.trim(),
          enabled: true,
          createdAt: new Date().toISOString(),
        },
      ],
    });
  };

  const onSave = () =>
    save.mutate(draft, {
      onSuccess: () => toast.success("Integrations saved"),
      onError: (e) => toast.error(getErrorMessage(e)),
    });

  return (
    <PageLayout title="API Integrations" subtitle="Outbound endpoints the platform can push events to.">
      <div className=" space-y-6">
        {draft.integrations.length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
            No integrations configured.
          </p>
        )}

        <ul className="space-y-1.5">
          {draft.integrations.map((it) => (
            <li key={it.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <span className="w-16 shrink-0 text-xs uppercase text-muted-foreground">{it.kind}</span>
              <span className="w-32 shrink-0 truncate font-medium">{it.name}</span>
              <span className="flex-1 truncate font-mono text-xs text-muted-foreground">{it.url}</span>
              <Checkbox
                checked={it.enabled}
                onCheckedChange={(v) =>
                  setDraft({
                    ...draft,
                    integrations: draft.integrations.map((x) => (x.id === it.id ? { ...x, enabled: !!v } : x)),
                  })
                }
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDraft({ ...draft, integrations: draft.integrations.filter((x) => x.id !== it.id) })}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <SelectOption
            className="min-w-50"
            onValueChange={(value) => onValueChange("kind", value)}
            options={OPTIONS}
            value={values.kind}
          />
          <Input onChange={(e) => onValueChange("name", e.target.value)} placeholder="Name" value={values.name} />
          <Input onChange={(e) => onValueChange("url", e.target.value)} placeholder="URL" value={values.url} />
          <Button variant="outline" onClick={add}>
            <Plus className="size-4" /> Add
          </Button>
        </div>

        <Button onClick={onSave} disabled={save.isPending}>
          {save.isPending ? <Loader className="animate-spin" /> : "Save changes"}
        </Button>
      </div>
    </PageLayout>
  );
};

export default Page;
