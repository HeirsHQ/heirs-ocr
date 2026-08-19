"use client";

import { useState } from "react";
import { Loader } from "lucide-react";
import { toast } from "sonner";

import { MfaSetupDialog, RecoveryCodes, type MfaEnrolment } from "./mfa-setup-dialog";
import { Dialog, DialogContent } from "../ui/dialog";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { Field } from "./field";

/** Fallback when the caller supplies no mapper — an axios rejection has no useful `.message`. */
const defaultFormatError = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : "That didn't work. Please try again.";

/** Current MFA state for the signed-in user; mirrors `MfaStatus` on the backend. */
export type MfaSettingsStatus = { enabled: boolean; pending: boolean; recoveryCodesRemaining: number };

/**
 * The "two-factor authentication" block on a security page — the toggle, the
 * enrolment dialog, the recovery-code count, and the password re-check.
 *
 * Shared by the console and the portal. Both hit different endpoints through
 * different hooks, so the calls arrive as plain async functions; everything above
 * them (the step machine, the re-auth prompt, the one-time reveals) is identical
 * and lives here rather than being copied into two security pages.
 *
 * Disabling and re-minting codes both go through a password prompt because the
 * backend demands one: a hijacked session must not be able to strip the account
 * back to a single factor.
 */
export const MfaSettings = ({
  status,
  loading,
  begin,
  confirm,
  disable,
  regenerate,
  formatError = defaultFormatError,
}: {
  status?: MfaSettingsStatus;
  loading?: boolean;
  begin: () => Promise<MfaEnrolment>;
  confirm: (code: string) => Promise<{ recoveryCodes: string[] }>;
  disable: (password: string) => Promise<unknown>;
  regenerate: (password: string) => Promise<{ recoveryCodes: string[] }>;
  /**
   * Turns a rejected call into a message. Both apps pass `getErrorMessage` from
   * @heirs/api-client — this package deliberately has no axios dependency, so it
   * cannot read the API's error envelope itself.
   */
  formatError?: (err: unknown) => string;
}) => {
  const [showSetup, setShowSetup] = useState(false);
  const [reauth, setReauth] = useState<"disable" | "regenerate">();
  const [password, setPassword] = useState("");
  const [reauthError, setReauthError] = useState<string>();
  const [freshCodes, setFreshCodes] = useState<string[]>();
  const [busy, setBusy] = useState(false);

  const enabled = status?.enabled ?? false;
  const remaining = status?.recoveryCodesRemaining ?? 0;

  const closeReauth = () => {
    setReauth(undefined);
    setPassword("");
    setReauthError(undefined);
  };

  const submitReauth = async () => {
    setBusy(true);
    setReauthError(undefined);
    try {
      if (reauth === "disable") {
        await disable(password);
        toast.success("Two-factor authentication disabled");
      } else {
        // Shown once — the old set stopped working the moment these were minted.
        const { recoveryCodes } = await regenerate(password);
        setFreshCodes(recoveryCodes);
      }
      closeReauth();
    } catch (err) {
      setReauthError(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Two-factor authentication</p>
          <p className="text-xs text-muted-foreground text-pretty">
            Require a TOTP code from an authenticator app on every sign-in.
          </p>
          {enabled && (
            <p className="text-xs text-muted-foreground">
              {remaining} recovery code{remaining === 1 ? "" : "s"} left.{" "}
              <button type="button" className="underline underline-offset-2" onClick={() => setReauth("regenerate")}>
                Generate new codes
              </button>
            </p>
          )}
        </div>
        {loading ? (
          <Loader className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Switch
            checked={enabled}
            onCheckedChange={(next) => (next ? setShowSetup(true) : setReauth("disable"))}
            aria-label="Toggle two-factor authentication"
          />
        )}
      </div>
      <MfaSetupDialog
        open={showSetup}
        onOpenChange={setShowSetup}
        begin={begin}
        confirm={confirm}
        formatError={formatError}
        onEnrolled={() => toast.success("Two-factor authentication enabled")}
      />
      {/* Re-minted codes arrive outside the setup dialog, so they get their own reveal. */}
      <Dialog open={!!freshCodes} onOpenChange={(o) => !o && setFreshCodes(undefined)}>
        <DialogContent
          title="New recovery codes"
          description="Your previous codes no longer work."
          className="sm:max-w-100"
        >
          <div className="mt-4 flex flex-col items-center gap-y-4">
            {freshCodes && <RecoveryCodes codes={freshCodes} />}
            <Button className="w-full" onClick={() => setFreshCodes(undefined)}>
              I&apos;ve saved them
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!reauth} onOpenChange={(o) => !o && !busy && closeReauth()}>
        <DialogContent
          title={reauth === "disable" ? "Turn off two-factor authentication" : "Generate new recovery codes"}
          description="Confirm your password to continue."
          className="sm:max-w-100"
        >
          <div className="mt-4 space-y-4">
            <Field label="Password" htmlFor="mfa-reauth" error={reauthError}>
              <Input
                id="mfa-reauth"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && password && !busy && submitReauth()}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={closeReauth} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant={reauth === "disable" ? "destructive" : "default"}
                onClick={submitReauth}
                disabled={busy || !password}
              >
                {busy ? <Loader className="size-4 animate-spin" /> : "Confirm"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
