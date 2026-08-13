"use client";

import { Loader, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { SecurityPosture, SecuritySettings } from "@/types/admin-console";
import { useSaveSecurity, useSecurity } from "@/hooks/api/use-admin-console";
import { PageLayout, Skeleton } from "@/components/shared";
import { getErrorMessage } from "@heirs/api-client";
import { Checkbox } from "@heirs/ui";
import { Button } from "@heirs/ui";
import { Input } from "@heirs/ui";
import { cn } from "@heirs/ui";

const Pill = ({ label, ok, value }: { label: string; ok: boolean; value?: string }) => (
  <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
    <span className={cn("inline-block size-2 rounded-full", ok ? "bg-emerald-500" : "bg-amber-500")} />
    {label}
    {value && <span className="text-xs text-muted-foreground">{value}</span>}
  </span>
);

const PostureView = ({ p }: { p: SecurityPosture }) => (
  <div className="flex flex-wrap gap-2">
    <Pill label="Auth" ok={p.authEnabled} value={p.authEnabled ? "enabled" : "disabled"} />
    <Pill
      label="Rate limit"
      ok={p.rateLimitEnabled}
      value={p.rateLimitEnabled ? `${p.rateLimitMax}/${p.rateLimitWindowSeconds}s` : "off"}
    />
    <Pill label="CORS" ok={p.corsClosed} value={p.corsClosed ? "closed" : "open"} />
    <Pill label="Admin session" ok value={`${Math.round(p.adminSessionTtlSeconds / 60)}m`} />
    <Pill label="Tenant session" ok value={`${Math.round(p.tenantSessionTtlSeconds / 60)}m`} />
  </div>
);

const Page = () => {
  const query = useSecurity();
  const save = useSaveSecurity();
  const [draft, setDraft] = useState<SecuritySettings | null>(null);
  const [ip, setIp] = useState("");
  const [synced, setSynced] = useState<SecuritySettings | null>(null);
  if (query.data && query.data.settings !== synced) {
    setSynced(query.data.settings);
    setDraft(query.data.settings);
  }

  if (query.isError)
    return (
      <PageLayout title="Security">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {getErrorMessage(query.error)}
        </div>
      </PageLayout>
    );

  if (!draft || !query.data)
    return (
      <PageLayout title="Security" subtitle="Effective posture (read-only) and editable security policy.">
        <Skeleton skeleton="profile" />
      </PageLayout>
    );

  const addIp = () => {
    const v = ip.trim();
    if (!v || draft.ipAllowlist.includes(v)) return;
    setDraft({ ...draft, ipAllowlist: [...draft.ipAllowlist, v] });
    setIp("");
  };

  const onSave = () =>
    save.mutate(draft, {
      onSuccess: () => toast.success("Security settings saved"),
      onError: (e) => toast.error(getErrorMessage(e)),
    });

  return (
    <PageLayout title="Security" subtitle="Effective posture (read-only) and editable security policy.">
      <div className=" space-y-6">
        <section className="space-y-2">
          <p className="text-sm font-medium">Effective posture</p>
          <PostureView p={query.data.posture} />
        </section>

        <section className="space-y-4">
          <p className="text-sm font-medium">Policy</p>

          <label className="flex items-center gap-3 rounded-md border px-3 py-3 text-sm">
            <Checkbox checked={draft.enforceHttps} onCheckedChange={(v) => setDraft({ ...draft, enforceHttps: !!v })} />
            <span>
              <span className="font-medium">Enforce HTTPS</span>
              <span className="block text-xs text-muted-foreground">Reject non-TLS requests at the edge.</span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Session idle timeout (min)</label>
              <Input
                type="number"
                min={1}
                value={draft.sessionIdleTimeoutMinutes}
                onChange={(e) => setDraft({ ...draft, sessionIdleTimeoutMinutes: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Password minimum length</label>
              <Input
                type="number"
                min={8}
                max={128}
                value={draft.passwordMinLength}
                onChange={(e) => setDraft({ ...draft, passwordMinLength: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">IP allowlist</label>
            {draft.ipAllowlist.length === 0 && (
              <p className="text-xs text-muted-foreground">Empty — all IPs allowed.</p>
            )}
            <ul className="space-y-1.5">
              {draft.ipAllowlist.map((entry) => (
                <li key={entry} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <span className="flex-1 font-mono text-xs">{entry}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDraft({ ...draft, ipAllowlist: draft.ipAllowlist.filter((x) => x !== entry) })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input placeholder="203.0.113.0/24" value={ip} onChange={(e) => setIp(e.target.value)} />
              <Button variant="outline" onClick={addIp}>
                <Plus className="size-4" /> Add
              </Button>
            </div>
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
