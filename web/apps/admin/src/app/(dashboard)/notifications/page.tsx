"use client";

import { Loader, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useNotifications, useSaveNotifications } from "@/hooks/api/use-admin-console";
import type { NotificationChannel, NotificationSettings } from "@/types/admin-console";
import { PageLayout, Skeleton } from "@/components/shared";
import { getErrorMessage } from "@heirs/api-client";
import { Checkbox } from "@heirs/ui";
import { Button } from "@heirs/ui";
import { Input } from "@heirs/ui";
import { cn } from "@heirs/ui";

const EVENT_LABELS: Record<keyof NotificationSettings["events"], string> = {
  jobFailed: "Job failed",
  quotaExceeded: "Quota exceeded",
  tenantCreated: "Tenant created",
  subscriptionChanged: "Subscription changed",
};

const selectClass = cn(
  "h-8 rounded-md border border-input bg-transparent px-2.5 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
);

const Page = () => {
  const query = useNotifications();
  const save = useSaveNotifications();
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const [synced, setSynced] = useState<NotificationSettings | null>(null);
  // Seed the editable draft from server data once (and re-seed if it changes),
  // adjusting state during render rather than in an effect.
  if (query.data && query.data.settings !== synced) {
    setSynced(query.data.settings);
    setDraft(query.data.settings);
  }

  const [type, setType] = useState<NotificationChannel["type"]>("email");
  const [target, setTarget] = useState("");

  if (query.isError)
    return (
      <PageLayout title="Notifications">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {getErrorMessage(query.error)}
        </div>
      </PageLayout>
    );

  if (!draft)
    return (
      <PageLayout title="Notifications" subtitle="Choose which events alert you and where they are delivered.">
        <Skeleton skeleton="profile" />
      </PageLayout>
    );

  const addChannel = () => {
    if (!target.trim()) return;
    setDraft({
      ...draft,
      channels: [...draft.channels, { id: crypto.randomUUID(), type, target: target.trim(), enabled: true }],
    });
    setTarget("");
  };

  const onSave = () =>
    save.mutate(draft, {
      onSuccess: () => toast.success("Notification settings saved"),
      onError: (e) => toast.error(getErrorMessage(e)),
    });

  return (
    <PageLayout title="Notifications" subtitle="Choose which events alert you and where they are delivered.">
      <div className=" space-y-6">
        <section className="space-y-2">
          <p className="text-sm font-medium">Events</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(EVENT_LABELS) as (keyof NotificationSettings["events"])[]).map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.events[key]}
                  onCheckedChange={(v) => setDraft({ ...draft, events: { ...draft.events, [key]: !!v } })}
                />
                {EVENT_LABELS[key]}
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-sm font-medium">Channels</p>
          {draft.channels.length === 0 && <p className="text-sm text-muted-foreground">No channels configured.</p>}
          <ul className="space-y-1.5">
            {draft.channels.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="w-16 shrink-0 text-xs uppercase text-muted-foreground">{c.type}</span>
                <span className="flex-1 truncate font-mono text-xs">{c.target}</span>
                <Checkbox
                  checked={c.enabled}
                  onCheckedChange={(v) =>
                    setDraft({
                      ...draft,
                      channels: draft.channels.map((x) => (x.id === c.id ? { ...x, enabled: !!v } : x)),
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDraft({ ...draft, channels: draft.channels.filter((x) => x.id !== c.id) })}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <select className={selectClass} value={type} onChange={(e) => setType(e.target.value as never)}>
              <option value="email">email</option>
              <option value="webhook">webhook</option>
            </select>
            <Input
              placeholder={type === "email" ? "alerts@acme.com" : "https://hooks…"}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
            <Button variant="outline" onClick={addChannel}>
              <Plus className="size-4" /> Add
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
