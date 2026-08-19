"use client";

import { Globe, Loader, Plus, Trash2, Trash } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";

import { EmptyState, ErrorState, PageLayout, Skeleton, StatusBadge } from "@/components/shared";
import type { SecurityPosture, SecuritySettings } from "@/types/admin-console";
import type { RetentionSettings } from "@heirs/api-client";
import { MfaSettings, SessionList } from "@heirs/ui";
import { getErrorMessage } from "@heirs/api-client";
import { Checkbox } from "@heirs/ui";
import { Switch } from "@heirs/ui";
import { Label } from "@heirs/ui";
import { Button } from "@heirs/ui";
import { Input } from "@heirs/ui";
import {
  useRetention,
  useRunRetentionSweep,
  useSaveRetention,
  useSaveSecurity,
  useSecurity,
} from "@/hooks/api/use-admin-console";
import {
  useAdminMfaBegin,
  useAdminMfaConfirm,
  useAdminMfaDisable,
  useAdminMfaRecoveryCodes,
  useAdminMfaStatus,
  useAdminSessions,
  useChangeAdminPassword,
  useRevokeAdminSessions,
} from "@/hooks/api/use-admin-security";

/** Live posture read off the environment — amber means "not hardened", not "broken". */
const Pill = ({ label, ok, value }: { label: string; ok: boolean; value?: string }) => (
  <StatusBadge
    tone={ok ? "healthy" : "attention"}
    label={value ? `${label} · ${value}` : label}
    className="normal-case"
  />
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

/**
 * The operator's own second factor. Deliberately its own component, above the
 * platform policy below: the two are unrelated, and this one must stay reachable
 * even when the settings query fails — otherwise a settings outage would also be
 * an "I can't turn on MFA" outage.
 */
const AccountSecurity = () => {
  const status = useAdminMfaStatus();
  const begin = useAdminMfaBegin();
  const confirm = useAdminMfaConfirm();
  const disable = useAdminMfaDisable();
  const regenerate = useAdminMfaRecoveryCodes();

  return (
    <MfaSettings
      status={status.data}
      loading={status.isPending}
      begin={() => begin.mutateAsync()}
      confirm={(code) => confirm.mutateAsync(code)}
      disable={(password) => disable.mutateAsync(password)}
      regenerate={(password) => regenerate.mutateAsync(password)}
      formatError={getErrorMessage}
    />
  );
};

/**
 * Self-service password change — the twin of the portal's section.
 *
 * The server requires the current password, applies the platform's minimum-length
 * policy, and revokes every other session on success; this form only reports what it
 * did.
 */
const passwordSchema = z
  .object({
    current: z.string().min(1, "Required"),
    next: z.string().min(8, "At least 8 characters"),
    confirm: z.string().min(1, "Required"),
  })
  .refine((d) => d.next === d.confirm, { message: "Passwords do not match", path: ["confirm"] });

type PasswordValues = z.infer<typeof passwordSchema>;

const PasswordSection = () => {
  const change = useChangeAdminPassword();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) });

  const onSubmit = handleSubmit(({ current, next }) =>
    change.mutateAsync({ current, next }).then(
      ({ sessionsRevoked }) => {
        toast.success(
          sessionsRevoked > 0
            ? `Password updated — signed out ${sessionsRevoked} other session${sessionsRevoked === 1 ? "" : "s"}`
            : "Password updated",
        );
        reset();
      },
      (error) => toast.error(getErrorMessage(error)),
    ),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Current password</Label>
          <Input type="password" autoComplete="current-password" {...register("current")} />
          {errors.current && <p className="text-xs text-destructive">{errors.current.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>New password</Label>
          <Input type="password" autoComplete="new-password" {...register("next")} />
          {errors.next && <p className="text-xs text-destructive">{errors.next.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>Confirm new password</Label>
          <Input type="password" autoComplete="new-password" {...register("confirm")} />
          {errors.confirm && <p className="text-xs text-destructive">{errors.confirm.message}</p>}
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting || change.isPending}>
          {isSubmitting || change.isPending ? <Loader className="animate-spin" /> : "Update password"}
        </Button>
      </div>
    </form>
  );
};

/** Live sign-ins for the signed-in operator — the twin of the portal's section. */
const SessionsSection = () => {
  const sessions = useAdminSessions();
  const revoke = useRevokeAdminSessions();

  return (
    <SessionList
      sessions={sessions.data?.sessions}
      loading={sessions.isPending}
      onRevokeOthers={() => revoke.mutateAsync()}
      formatError={getErrorMessage}
    />
  );
};

/**
 * Retention windows and a manual sweep.
 *
 * Separate from the policy panel below because it destroys data on a timer rather
 * than constraining access — an operator shortening a window here is deleting the
 * existing backlog, not just changing what happens next, so the copy says so.
 */
const RetentionPanel = () => {
  const query = useRetention();
  const save = useSaveRetention();
  const sweep = useRunRetentionSweep();
  const [draft, setDraft] = useState<RetentionSettings | null>(null);
  const [synced, setSynced] = useState<RetentionSettings | null>(null);

  if (query.data && query.data.settings !== synced) {
    setSynced(query.data.settings);
    setDraft(query.data.settings);
  }

  if (query.isError)
    return (
      <ErrorState
        title="Couldn't load retention policy"
        description={getErrorMessage(query.error)}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  if (!draft) return <Skeleton skeleton="profile" />;

  const onSave = () =>
    save.mutate(draft, {
      onSuccess: () => toast.success("Retention policy saved"),
      onError: (e) => toast.error(getErrorMessage(e)),
    });

  const onSweep = () =>
    sweep.mutate(undefined, {
      onSuccess: (r) =>
        r.skipped
          ? toast.info(r.skipped === "disabled" ? "Retention is switched off" : "A sweep just ran — try again shortly")
          : toast.success(`Deleted ${r.documents} document record(s) and ${r.auditEvents} audit event(s)`),
      onError: (e) => toast.error(getErrorMessage(e)),
    });

  return (
    <section className="space-y-4">
      {/* No heading of its own — the section wrapper supplies "Retention". */}
      <p className="text-xs text-muted-foreground">
        Records past these windows are deleted permanently by an hourly sweep. Shortening a window applies to records
        already stored, not only to new ones.
      </p>

      <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-3 text-sm">
        <span>
          <span className="font-medium">Automatic deletion</span>
          <span className="block text-xs text-muted-foreground">
            Turn off to preserve everything — for example during an investigation.
          </span>
        </span>
        <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Document records (days)</Label>
          <Input
            type="number"
            min={1}
            max={3650}
            value={draft.documentRetentionDays}
            onChange={(e) => setDraft({ ...draft, documentRetentionDays: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label>Audit events (days)</Label>
          <Input
            type="number"
            min={1}
            max={3650}
            value={draft.auditRetentionDays}
            onChange={(e) => setDraft({ ...draft, auditRetentionDays: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onSave} disabled={save.isPending}>
          {save.isPending ? <Loader className="animate-spin" /> : "Save retention"}
        </Button>
        <Button variant="outline" onClick={onSweep} disabled={sweep.isPending}>
          {sweep.isPending ? <Loader className="animate-spin" /> : <Trash className="size-4" />}
          Run sweep now
        </Button>
      </div>
    </section>
  );
};

/** The platform-wide policy panel — everything below the account section. */
const PolicyPanel = () => {
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
      <ErrorState
        title="Couldn't load security settings"
        description={getErrorMessage(query.error)}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );

  if (!draft || !query.data) return <Skeleton skeleton="profile" />;

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
    <>
      <div className=" space-y-6">
        <section className="space-y-2">
          <p className="text-sm font-medium">Effective Posture</p>
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
              <Label>Session idle timeout (min)</Label>
              <Input
                type="number"
                min={1}
                value={draft.sessionIdleTimeoutMinutes}
                onChange={(e) => setDraft({ ...draft, sessionIdleTimeoutMinutes: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label>Password minimum length</Label>
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
            <Label>IP allowlist</Label>
            {/* An empty allowlist is permissive, not merely unset — say so, because
                "no entries" reads as "locked down" to anyone skimming. */}
            {draft.ipAllowlist.length === 0 && (
              <EmptyState
                icon={Globe}
                title="No IP restrictions"
                description="An empty allowlist lets the console be reached from any address. Add an entry below to restrict it."
              />
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
    </>
  );
};

/**
 * Same sectioned layout as the portal's security page, so an operator moving between
 * the two reads the same shape rather than two unrelated designs.
 */
const SECTIONS = [
  { label: "Your account", component: AccountSecurity },
  { label: "Password", component: PasswordSection },
  { label: "Sessions", component: SessionsSection },
  { label: "Retention", component: RetentionPanel },
  { label: "Platform policy", component: PolicyPanel },
] as const;

const Page = () => (
  <PageLayout title="Security" subtitle="Your account, active sessions, retention, and platform-wide policy.">
    <div className="space-y-6">
      {SECTIONS.map(({ label, component: Section }) => (
        <div key={label} className="space-y-2">
          <p className="text-sm">{label}</p>
          <div className="rounded-md border p-4">
            <Section />
          </div>
        </div>
      ))}
    </div>
  </PageLayout>
);

export default Page;
