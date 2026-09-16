"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Loader } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { z } from "zod";

import { useTenantForgotPassword, type TenantPasswordResetPending } from "@/hooks/api/use-tenant-auth";
import { getErrorMessage } from "@heirs/api-client";
import { Button, Field, Input } from "@heirs/ui";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
});

type FormValues = z.infer<typeof schema>;

/**
 * Step one of a password reset. The backend answers the same whether or not the
 * address has an account, so the confirmation below must not claim a link was sent —
 * only that one is on its way *if* the account exists.
 */
const Page = () => {
  const forgot = useTenantForgotPassword();
  const [sent, setSent] = useState<TenantPasswordResetPending>();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const request = (email: string, onSuccess?: () => void) =>
    forgot.mutate(
      { email: email.trim() },
      {
        onSuccess: (result) => {
          setSent(result);
          onSuccess?.();
        },
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );

  const onSubmit = handleSubmit(({ email }) => request(email));

  if (sent) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <p className="text-2xl font-semibold tracking-tight">Check your email</p>
          <p className="text-muted-foreground text-sm text-pretty">
            If an account exists for {sent.email}, we&rsquo;ve sent it a link to reset the password. The link works once
            and expires in {sent.expiresInMinutes} minutes.
          </p>
        </div>
        <div className="text-muted-foreground space-y-2 text-sm">
          <p>
            Didn&rsquo;t get it? Check spam, then{" "}
            <button
              type="button"
              className="text-foreground underline disabled:opacity-50"
              disabled={forgot.isPending}
              onClick={() =>
                request(sent.email, () => toast.success("If the account exists, a new link is on its way."))
              }
            >
              send another link
            </button>
            .
          </p>
          <p>
            Wrong address?{" "}
            <button type="button" className="text-foreground underline" onClick={() => setSent(undefined)}>
              Try a different email
            </button>
          </p>
        </div>
        <Button
          variant="outline"
          className="w-full"
          nativeButton={false}
          render={<Link href="/login">Back to sign in</Link>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-2xl font-semibold tracking-tight">Forgot your password?</p>
        <p className="text-muted-foreground text-sm">
          Enter the email you sign in with and we&rsquo;ll send you a link to choose a new one.
        </p>
      </div>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
        </Field>
        <Button type="submit" className="w-full" disabled={forgot.isPending}>
          {forgot.isPending ? <Loader className="animate-spin" /> : "Send reset link"}
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

export default Page;
