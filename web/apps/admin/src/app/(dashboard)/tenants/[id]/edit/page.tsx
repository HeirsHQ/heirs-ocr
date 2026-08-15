"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button, Field, Input, PageLayout, Skeleton, ErrorState, Switch, Textarea, ToggleList } from "@heirs/ui";
import { useTenant, useUpdateTenant } from "@/hooks/api/use-admin-tenants";
import { useOcrFunctionKeys } from "@/hooks/api/use-admin-plans";
import { getErrorMessage } from "@heirs/api-client";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  rateLimit: z
    .string()
    .regex(/^[1-9]\d*$/, "Must be a positive integer")
    .or(z.literal("")),
  disabled: z.boolean(),
  allowedFunctions: z.array(z.string()),
  allowedOrigins: z.string(),
});

type FormValues = z.infer<typeof schema>;

const Page = () => {
  const id = useParams().id as string;
  const router = useRouter();
  const { data, isPending, isError, error, refetch, isFetching } = useTenant(id);
  const update = useUpdateTenant();
  const functions = useOcrFunctionKeys();

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", rateLimit: "", disabled: false, allowedFunctions: [], allowedOrigins: "" },
  });

  useEffect(() => {
    if (data) {
      reset({
        name: data.tenant.name ?? "",
        rateLimit: data.tenant.rateLimit?.toString() ?? "",
        disabled: !!data.tenant.disabled,
        allowedFunctions: data.tenant.allowedFunctions ?? [],
        allowedOrigins: (data.tenant.allowedOrigins ?? []).join("\n"),
      });
    }
  }, [data, reset]);

  const onSubmit = handleSubmit((values) => {
    const keyHash = data?.keys[0];
    if (!keyHash) {
      toast.error("No key hash found for this tenant");
      return;
    }
    update.mutate(
      {
        keyHash,
        patch: {
          name: values.name,
          rateLimit: values.rateLimit ? Number(values.rateLimit) : undefined,
          disabled: values.disabled,
          allowedFunctions: values.allowedFunctions,
          allowedOrigins: values.allowedOrigins
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      },
      {
        onSuccess: () => {
          toast.success("Tenant updated");
          router.push(`/tenants/${id}`);
        },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  });

  if (isPending) {
    return (
      <PageLayout title="Edit tenant" subtitle="">
        <Skeleton skeleton="profile" />
      </PageLayout>
    );
  }

  if (isError) {
    return (
      <PageLayout title="Edit tenant" subtitle="">
        <ErrorState
          title="Couldn't load tenant"
          description={getErrorMessage(error)}
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Edit tenant" subtitle={`Registry settings for ${data.tenant.tenantId}.`}>
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => router.push(`/tenants/${id}`)}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Display name" error={errors.name?.message}>
              <Input placeholder="Acme Corp" aria-invalid={!!errors.name} {...register("name")} />
            </Field>
            <Field label="Rate limit /min" hint="Blank = default" error={errors.rateLimit?.message}>
              <Input
                inputMode="numeric"
                placeholder="60"
                aria-invalid={!!errors.rateLimit}
                {...register("rateLimit")}
              />
            </Field>
          </div>
          <Field label="Allowed functions" hint="None selected = all functions allowed">
            {functions.isPending ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : functions.isError ? (
              <p className="text-xs text-destructive">{getErrorMessage(functions.error)}</p>
            ) : (
              <Controller
                control={control}
                name="allowedFunctions"
                render={({ field }) => (
                  <ToggleList
                    options={functions.data?.functions ?? []}
                    selected={field.value}
                    onToggle={(v) =>
                      field.onChange(field.value.includes(v) ? field.value.filter((f) => f !== v) : [...field.value, v])
                    }
                    columns={2}
                  />
                )}
              />
            )}
          </Field>
          <Field label="Allowed origins" hint="One per line. Blank = closed.">
            <Textarea
              rows={3}
              placeholder={"https://app.acme.com\nhttps://staging.acme.com"}
              {...register("allowedOrigins")}
            />
          </Field>
          <Controller
            control={control}
            name="disabled"
            render={({ field }) => (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={field.value} onCheckedChange={field.onChange} />
                Disabled — key rejected without deleting
              </label>
            )}
          />
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? <Loader className="animate-spin" /> : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push(`/tenants/${id}`)}
              disabled={update.isPending}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </PageLayout>
  );
};

export default Page;
