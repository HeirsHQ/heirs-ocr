"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Loader } from "lucide-react";
import { Suspense } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@heirs/ui";
import { useTenantLogin } from "@/hooks/api/use-tenant-auth";
import { getErrorMessage } from "@heirs/api-client";
import { Input } from "@heirs/ui";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type FormValues = z.infer<typeof schema>;

const LoginForm = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useTenantLogin();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit((values) => {
    login.mutate(values, {
      onSuccess: () => router.replace(searchParams.get("next") || "/ocr"),
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  });

  return (
    <div className="space-y-6 p-8 lg:min-w-125">
      <div className="space-y-1 text-center">
        <p className="font-medium text-xl">Welcome Back</p>
        <p className="text-sm text-muted-foreground">Sign in to your Heirs OCR workspace.</p>
      </div>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
        </div>
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? <Loader className="animate-spin" /> : "Sign in"}
        </Button>
      </form>
    </div>
  );
};

const Page = () => (
  <Suspense fallback={null}>
    <LoginForm />
  </Suspense>
);

export default Page;
