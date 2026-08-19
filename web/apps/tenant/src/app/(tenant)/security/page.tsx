"use client";

import { KeyRound, Loader, MonitorSmartphone, ShieldCheck, Wifi } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button, Field, Input, MfaSettings, PageLayout, SessionList, Switch, Textarea } from "@heirs/ui";
import { getErrorMessage, type TenantIpAllowlist } from "@heirs/api-client";
import {
  useChangeTenantPassword,
  useSaveTenantIpAllowlist,
  useTenantIpAllowlist,
  useRevokeTenantSessions,
  useTenantSessions,
  useTenantMfaBegin,
  useTenantMfaConfirm,
  useTenantMfaDisable,
  useTenantMfaRecoveryCodes,
  useTenantMfaStatus,
} from "@/hooks/api/use-tenant-security";

// ── MFA ───────────────────────────────────────────────────────────────────────

const MfaSection = () => {
  const status = useTenantMfaStatus();
  const begin = useTenantMfaBegin();
  const confirm = useTenantMfaConfirm();
  const disable = useTenantMfaDisable();
  const regenerate = useTenantMfaRecoveryCodes();

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

// ── Password change ───────────────────────────────────────────────────────────

const passwordSchema = z
  .object({
    current: z.string().min(1, "Required"),
    next: z.string().min(8, "At least 8 characters"),
    confirm: z.string().min(1, "Required"),
  })
  .refine((d) => d.next === d.confirm, { message: "Passwords do not match", path: ["confirm"] });

type PasswordValues = z.infer<typeof passwordSchema>;

const PasswordSection = () => {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) });

  const change = useChangeTenantPassword();

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
      (error) => {
        // The server rejects a wrong current password, a reused one, and anything
        // below the platform's minimum length — each with a message worth showing.
        toast.error(getErrorMessage(error));
      },
    ),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Current password" error={errors.current?.message}>
          <Input type="password" autoComplete="current-password" {...register("current")} />
        </Field>
        <Field label="New password" error={errors.next?.message}>
          <Input type="password" autoComplete="new-password" {...register("next")} />
        </Field>
        <Field label="Confirm new password" error={errors.confirm?.message}>
          <Input type="password" autoComplete="new-password" {...register("confirm")} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting || change.isPending}>
          {isSubmitting || change.isPending ? <Loader className="animate-spin" /> : "Update password"}
        </Button>
      </div>
    </form>
  );
};

// ── Active sessions ───────────────────────────────────────────────────────────

const SessionsSection = () => {
  const sessions = useTenantSessions();
  const revoke = useRevokeTenantSessions();

  return (
    <SessionList
      sessions={sessions.data?.sessions}
      loading={sessions.isPending}
      onRevokeOthers={() => revoke.mutateAsync()}
      formatError={getErrorMessage}
    />
  );
};

// ── IP allowlist ──────────────────────────────────────────────────────────────

const IpAllowlistSection = () => {
  const settings = useTenantIpAllowlist();
  const save = useSaveTenantIpAllowlist();

  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");
  const [synced, setSynced] = useState<TenantIpAllowlist | null>(null);

  // Seed the form from the server once, then leave the user's edits alone.
  if (settings.data && settings.data !== synced) {
    setSynced(settings.data);
    setEnabled(settings.data.ipAllowlistEnabled);
    setText(settings.data.ipAllowlist.join("\n"));
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(
      {
        ipAllowlistEnabled: enabled,
        ipAllowlist: text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      },
      {
        onSuccess: () => toast.success("IP allowlist saved"),
        // The server refuses a list that would lock the caller out, and rejects a
        // malformed CIDR — both arrive here as a message worth showing verbatim.
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">IP allowlist</p>
          <p className="text-xs text-muted-foreground">
            Restrict portal sign-ins to specific IP addresses or CIDR ranges. Existing sessions are not affected.
          </p>
        </div>
        {settings.isPending ? (
          <Loader className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable IP allowlist" />
        )}
      </div>
      {enabled && (
        <>
          <Field label="Allowed IPs / CIDRs" hint="One entry per line, e.g. 203.0.113.0/24">
            <Textarea
              rows={4}
              placeholder={"203.0.113.42\n10.0.0.0/8"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? <Loader className="size-3.5 animate-spin" /> : "Save allowlist"}
            </Button>
          </div>
        </>
      )}
    </form>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { icon: ShieldCheck, label: "Your account", component: MfaSection },
  { icon: KeyRound, label: "Password", component: PasswordSection },
  { icon: MonitorSmartphone, label: "Sessions", component: SessionsSection },
  { icon: Wifi, label: "IP allowlist", component: IpAllowlistSection },
] as const;

const Page = () => (
  <PageLayout title="Security" subtitle="Manage 2FA, password, active sessions, and IP restrictions.">
    <div className="space-y-6">
      {/* `icon` is still carried on SECTIONS but no longer rendered in the heading. */}
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
