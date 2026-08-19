"use client";

import { useState } from "react";
import { Loader } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Field } from "./field";

/**
 * The second step of a login: the password was accepted, but the server returned a
 * challenge instead of a session and is waiting for the code.
 *
 * Shared by both apps because the two login pages are otherwise unrelated — the
 * flow, not the styling, is what would drift if this were copied.
 *
 * It accepts a recovery code in the same box as a TOTP code (the backend tries both
 * against one input), so the input is not restricted to six digits — a user reaching
 * for a recovery code is already having a bad day and should not have to find a
 * second form to do it.
 */
export const MfaChallengeForm = ({
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  onSubmit: (code: string) => void;
  /** Back to the password step — the challenge is abandoned, not consumed. */
  onCancel?: () => void;
  pending?: boolean;
  error?: string;
}) => {
  const [code, setCode] = useState("");
  const trimmed = code.trim();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-2xl font-semibold tracking-tight">Two-factor authentication</p>
        <p className="text-sm text-muted-foreground text-pretty">
          Enter the 6-digit code from your authenticator app, or one of your recovery codes.
        </p>
      </div>

      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed && !pending) onSubmit(trimmed);
        }}
      >
        <Field label="Verification code" htmlFor="mfa-code" error={error}>
          <Input
            id="mfa-code"
            autoFocus
            autoComplete="one-time-code"
            placeholder="123456"
            aria-invalid={!!error}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="font-mono tracking-widest"
          />
        </Field>

        <Button type="submit" className="w-full" disabled={pending || !trimmed}>
          {pending ? <Loader className="animate-spin" /> : "Verify"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" className="w-full" onClick={onCancel} disabled={pending}>
            Back to sign in
          </Button>
        )}
      </form>
    </div>
  );
};
