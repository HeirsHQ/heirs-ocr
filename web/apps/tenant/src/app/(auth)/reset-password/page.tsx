"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Loader } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { z } from "zod";

import { useTenantResetPassword } from "@/hooks/api/use-tenant-auth";
import { getErrorMessage, getErrorStatus } from "@heirs/api-client";
import { Button, Field, Input } from "@heirs/ui";

/** Server policy is authoritative (it may require more); this is the platform floor. */
const MIN_LENGTH = 8;

const schema = z
  .object({
    password: z.string().min(MIN_LENGTH, `At least ${MIN_LENGTH} characters`),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof schema>;

/**
 * Step two of a password reset, reached from the emailed link. It does not sign the
 * user in: the backend revokes every session and hands back none, so an account with
 * MFA still goes through its second factor at /login.
 */
const ResetPasswordForm = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reset = useTenantResetPassword();

  // Captured once, then dropped from the address bar so the token doesn't linger in
  // history or get copied along with the URL.
  const [token] = useState(() => searchParams.get("token") ?? "");
  const [error, setError] = useState<{ message: string; linkDead: boolean }>();

  useEffect(() => {
    if (token) window.history.replaceState(null, "", window.location.pathname);
  }, [token]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(({ password }) => {
    setError(undefined);
    reset.mutate(
      { token, password },
      {
        onSuccess: () => {
          toast.success("Password updated. Sign in with your new password.");
          router.replace("/login");
        },
        // 401 means the link itself is spent or expired — only then is a new one the fix.
        onError: (mutationError) =>
          setError({ message: getErrorMessage(mutationError), linkDead: getErrorStatus(mutationError) === 401 }),
      },
    );
  });

  if (!token) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <p className="text-2xl font-semibold tracking-tight">Reset link missing</p>
          <p className="text-muted-foreground text-sm text-pretty">
            Open the link from your reset email again, or request a new one. Links work once and expire after 30
            minutes.
          </p>
        </div>
        <Button
          className="w-full"
          nativeButton={false}
          render={<Link href="/forgot-password">Request a new link</Link>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-2xl font-semibold tracking-tight">Choose a new password</p>
        <p className="text-muted-foreground text-sm text-pretty">
          You&rsquo;ll be signed out everywhere, then asked to sign in with the new password.
        </p>
      </div>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Field label="New password" htmlFor="password" error={errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
        </Field>
        <Field label="Confirm new password" htmlFor="confirmPassword" error={errors.confirmPassword?.message}>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
        </Field>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error.message}
            {error.linkDead && (
              <>
                {" "}
                <Link href="/forgot-password" className="underline">
                  Request a new link
                </Link>
              </>
            )}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={reset.isPending}>
          {reset.isPending ? <Loader className="animate-spin" /> : "Update password"}
        </Button>
      </form>
      <p className="text-muted-foreground text-center text-sm">
        Remembered it?{" "}
        <Link className="text-foreground underline" href="/login">
          Sign in
        </Link>
      </p>
    </div>
  );
};

const Page = () => (
  <Suspense fallback={null}>
    <ResetPasswordForm />
  </Suspense>
);

export default Page;
