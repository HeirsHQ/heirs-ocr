"use client";

import { KeyRound, Loader, MonitorSmartphone, ShieldCheck, Wifi } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button, Dialog, DialogContent, Field, Input, PageLayout, Switch, Textarea } from "@heirs/ui";

// ── MFA ───────────────────────────────────────────────────────────────────────

const MfaSection = () => {
  const [showSetup, setShowSetup] = useState(false);
  const [enabled, setEnabled] = useState(false);

  const toggle = (next: boolean) => {
    if (next) {
      setShowSetup(true);
    } else {
      // TODO: call DELETE /api/tenant/security/mfa
      toast.info("MFA disabled (stub)");
      setEnabled(false);
    }
  };

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Two-factor authentication</p>
          <p className="text-xs text-muted-foreground">
            Require a TOTP code from an authenticator app on every sign-in.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={toggle} aria-label="Toggle MFA" />
      </div>

      <Dialog open={showSetup} onOpenChange={(o) => !o && setShowSetup(false)}>
        <DialogContent
          title="Set up two-factor authentication"
          description="Scan the QR code with your authenticator app, then enter the 6-digit code to confirm."
          className="sm:max-w-100"
        >
          <div className="gap-y-6 flex flex-col items-center mt-4">
            {/* QR placeholder — swap for a real qrcode render once the backend endpoint exists */}
            <div className="flex size-40 items-center justify-center rounded-md border border-dashed bg-muted text-xs text-muted-foreground">
              QR code
            </div>
            <Field label="Verification code" className="w-full">
              <Input inputMode="numeric" maxLength={6} placeholder="123456" autoComplete="one-time-code" />
            </Field>
            <div className="flex justify-end gap-2 w-full">
              <Button variant="ghost" onClick={() => setShowSetup(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  // TODO: POST /api/tenant/security/mfa/verify
                  toast.info("MFA setup confirmed (stub)");
                  setEnabled(true);
                  setShowSetup(false);
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
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

  const onSubmit = handleSubmit((_values) => {
    // TODO: POST /api/tenant/security/password
    console.log(_values);
    toast.info("Password changed (stub)");
    reset();
  });

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <p className="text-sm font-medium">Change password</p>
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
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader className="animate-spin" /> : "Update password"}
        </Button>
      </div>
    </form>
  );
};

// ── Active sessions ───────────────────────────────────────────────────────────

const SessionsSection = () => {
  const [revoking, setRevoking] = useState(false);

  const revokeAll = () => {
    setRevoking(true);
    // TODO: DELETE /api/tenant/security/sessions
    setTimeout(() => {
      toast.info("All other sessions revoked (stub)");
      setRevoking(false);
    }, 600);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Active sessions</p>
          <p className="text-xs text-muted-foreground">
            Sign out all other devices. Your current session stays active.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={revokeAll} disabled={revoking}>
          {revoking ? <Loader className="size-3.5 animate-spin" /> : "Revoke all other sessions"}
        </Button>
      </div>
      {/* TODO: render a list of active sessions from GET /api/tenant/security/sessions */}
      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        Session list coming soon.
      </p>
    </div>
  );
};

// ── IP allowlist ──────────────────────────────────────────────────────────────

const ipSchema = z.object({
  enabled: z.boolean(),
  allowlist: z.string(),
});
type IpValues = z.infer<typeof ipSchema>;

const IpAllowlistSection = () => {
  const { register, control, handleSubmit } = useForm<IpValues>({
    resolver: zodResolver(ipSchema),
    defaultValues: { enabled: false, allowlist: "" },
  });

  const enabled = useWatch({ control, name: "enabled" });

  const onSubmit = handleSubmit((_values) => {
    // TODO: PUT /api/tenant/security/ip-allowlist
    console.log(_values);
    toast.info("IP allowlist saved (stub)");
  });

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">IP allowlist</p>
          <p className="text-xs text-muted-foreground">
            Restrict portal sign-ins to specific IP addresses or CIDR ranges.
          </p>
        </div>
        <Controller
          control={control}
          name="enabled"
          render={({ field }) => (
            <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Enable IP allowlist" />
          )}
        />
      </div>
      {enabled && (
        <>
          <Field label="Allowed IPs / CIDRs" hint="One entry per line, e.g. 203.0.113.0/24">
            <Textarea rows={4} placeholder={"203.0.113.42\n10.0.0.0/8"} {...register("allowlist")} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" size="sm">
              Save allowlist
            </Button>
          </div>
        </>
      )}
    </form>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { icon: ShieldCheck, label: "Two-factor authentication", component: MfaSection },
  { icon: KeyRound, label: "Password", component: PasswordSection },
  { icon: MonitorSmartphone, label: "Sessions", component: SessionsSection },
  { icon: Wifi, label: "IP allowlist", component: IpAllowlistSection },
] as const;

const Page = () => (
  <PageLayout title="Security" subtitle="Manage 2FA, password, active sessions, and IP restrictions.">
    <div className="space-y-6">
      {SECTIONS.map(({ icon: Icon, label, component: Section }) => (
        <div key={label} className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Icon className="size-4" />
            {label}
          </div>
          <Section />
        </div>
      ))}
    </div>
  </PageLayout>
);

export default Page;
