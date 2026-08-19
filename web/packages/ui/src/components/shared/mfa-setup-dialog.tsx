"use client";

import { Check, Copy, Loader, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { QrCode } from "./qr-code";
import { Field } from "./field";

/** What the backend hands back from `POST /security/mfa` — the pending enrolment. */
export type MfaEnrolment = { secret: string; otpauthUri: string };

/**
 * The one-time list of fallback codes. Only hashes are stored server-side, so this
 * panel is the user's single chance to keep them — hence the copy affordance and
 * the deliberately blunt warning.
 */
export const RecoveryCodes = ({ codes }: { codes: string[] }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select and copy them manually.");
    }
  };

  return (
    <div className="w-full space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Save your recovery codes</p>
        <p className="text-xs text-muted-foreground text-pretty">
          Each code signs you in once if you lose your authenticator. They are shown only now — only hashes are stored.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-1.5">
        {codes.map((code) => (
          <li key={code} className="rounded bg-muted px-2 py-1 text-center font-mono text-xs tracking-wider">
            {code}
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" onClick={copy} className="w-full">
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied ? "Copied" : "Copy all"}
      </Button>
    </div>
  );
};

/**
 * The whole enrolment flow in one dialog, shared by the console and the portal.
 *
 * Both apps pass the two async calls rather than pre-resolved state, so this owns
 * the step machine (scan → confirm → save codes) and neither app has to repeat it.
 * `begin` runs when the dialog opens; the dialog cannot be dismissed on the final
 * step by clicking away, because the codes are unrecoverable once it closes.
 */
export const MfaSetupDialog = ({
  open,
  onOpenChange,
  begin,
  confirm,
  onEnrolled,
  formatError = (err) => (err instanceof Error && err.message ? err.message : "That code didn't match."),
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  begin: () => Promise<MfaEnrolment>;
  confirm: (code: string) => Promise<{ recoveryCodes: string[] }>;
  /** Fired once the factor is live, so the caller can refetch its status query. */
  onEnrolled?: () => void;
  /** Turns a rejected call into a message; apps pass `getErrorMessage`. */
  formatError?: (err: unknown) => string;
}) => {
  const [enrolment, setEnrolment] = useState<MfaEnrolment>();
  const [codes, setCodes] = useState<string[]>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) {
      // Reset on close so re-opening starts a fresh enrolment rather than showing
      // a stale secret from an abandoned attempt.
      setEnrolment(undefined);
      setCodes(undefined);
      setCode("");
      setError(undefined);
      return;
    }

    let live = true;
    setBusy(true);
    begin()
      .then((next) => live && setEnrolment(next))
      .catch((err) => live && setError(formatError(err)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
    // `begin` is intentionally not a dependency: it is typically an inline closure,
    // and re-running enrolment on every parent render would churn a new secret each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const { recoveryCodes } = await confirm(code);
      setCodes(recoveryCodes);
      onEnrolled?.();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const done = !!codes;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !done && onOpenChange(false)}>
      <DialogContent
        title={done ? "Two-factor authentication is on" : "Set up two-factor authentication"}
        description={
          done
            ? "Keep these recovery codes somewhere safe before you close this."
            : "Scan the QR code with your authenticator app, then enter the 6-digit code it shows."
        }
        className="sm:max-w-100"
      >
        <div className="mt-4 flex flex-col items-center gap-y-6">
          {done ? (
            <>
              <RecoveryCodes codes={codes} />
              <Button className="w-full" onClick={() => onOpenChange(false)}>
                <ShieldCheck className="size-4" />
                I&apos;ve saved them
              </Button>
            </>
          ) : (
            <>
              {enrolment ? (
                <>
                  <QrCode value={enrolment.otpauthUri} />
                  <div className="w-full space-y-1 text-center">
                    <p className="text-xs text-muted-foreground">Can&apos;t scan? Enter this key manually:</p>
                    <code className="block break-all rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
                      {enrolment.secret}
                    </code>
                  </div>
                </>
              ) : (
                <div className="flex size-44 items-center justify-center">
                  <Loader className="size-5 animate-spin text-muted-foreground" />
                </div>
              )}

              <Field label="Verification code" className="w-full" error={error}>
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && code.length === 6 && !busy && submit()}
                />
              </Field>

              <div className="flex w-full justify-end gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={submit} disabled={busy || !enrolment || code.length !== 6}>
                  {busy ? <Loader className="size-4 animate-spin" /> : "Confirm"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
