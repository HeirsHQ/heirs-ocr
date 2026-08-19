"use client";

import { ArrowLeft, Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useOnboardTenant, type OnboardTenantPayload } from "@/hooks/api/use-admin-tenants";
import { PageLayout, SecretCallout, ToggleList } from "@/components/shared";
import { useOcrFunctionKeys, usePlans } from "@/hooks/api/use-admin-plans";
import { getErrorMessage, MAX_PAGE_SIZE } from "@heirs/api-client";
import { Field, SelectOption } from "@heirs/ui";
import { Textarea } from "@heirs/ui";
import { Button } from "@heirs/ui";
import { Input } from "@heirs/ui";

/**
 * Sentinel for "no subscription". The select cannot carry an empty-string value, so
 * the absence of a plan needs an explicit option value that maps back to `""`.
 */
const NO_PLAN = "__none__";

const toSlug = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

interface FormState {
  tenantId: string;
  name: string;
  rateLimit: string;
  allowedFunctions: string[];
  allowedOrigins: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  planId: string;
}

const empty: FormState = {
  tenantId: "",
  name: "",
  rateLimit: "",
  allowedFunctions: [],
  allowedOrigins: "",
  ownerName: "",
  ownerEmail: "",
  ownerPassword: "",
  planId: "",
};

const buildPayload = (s: FormState): { ok: true; payload: OnboardTenantPayload } | { ok: false; error: string } => {
  const tenantId = s.tenantId.trim();
  if (!tenantId) return { ok: false, error: "Tenant ID is required" };
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(tenantId))
    return { ok: false, error: "Tenant ID must be a slug (letters, digits, dot, dash, underscore)" };

  let rateLimit: number | undefined;
  if (s.rateLimit.trim() !== "") {
    if (!/^[1-9]\d*$/.test(s.rateLimit.trim()))
      return { ok: false, error: "Rate limit must be a positive whole number" };
    rateLimit = Number(s.rateLimit.trim());
  }

  const allowedOrigins = s.allowedOrigins
    .split(/[\n,]/)
    .map((o) => o.trim())
    .filter(Boolean);

  // Owner is optional as a group — but if any field is filled, all are required.
  const anyOwner = s.ownerName.trim() || s.ownerEmail.trim() || s.ownerPassword;
  let owner: OnboardTenantPayload["owner"];
  if (anyOwner) {
    if (!s.ownerName.trim()) return { ok: false, error: "Owner name is required (or clear all owner fields)" };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.ownerEmail.trim()))
      return { ok: false, error: "Enter a valid owner email (or clear all owner fields)" };
    if (s.ownerPassword.length < 8) return { ok: false, error: "Owner password must be at least 8 characters" };
    owner = { name: s.ownerName.trim(), email: s.ownerEmail.trim(), password: s.ownerPassword };
  }

  return {
    ok: true,
    payload: {
      tenant: {
        tenantId,
        name: s.name.trim() || undefined,
        rateLimit,
        allowedFunctions: s.allowedFunctions.length ? s.allowedFunctions : undefined,
        allowedOrigins: allowedOrigins.length ? allowedOrigins : undefined,
      },
      owner,
      planId: s.planId || undefined,
    },
  };
};

const Page = () => {
  const router = useRouter();
  const onboard = useOnboardTenant();
  const functions = useOcrFunctionKeys();
  // Feeds a plan picker, so it needs the whole catalog rather than a first page.
  const plans = usePlans({ pageSize: MAX_PAGE_SIZE });

  const [s, setS] = useState<FormState>(empty);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((p) => ({ ...p, [k]: v }));
  const toggleFn = (fn: string) =>
    setS((p) => ({
      ...p,
      allowedFunctions: p.allowedFunctions.includes(fn)
        ? p.allowedFunctions.filter((f) => f !== fn)
        : [...p.allowedFunctions, fn],
    }));

  const submit = () => {
    setError(null);
    const built = buildPayload(s);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    onboard.mutate(built.payload, {
      onSuccess: (created) => {
        setApiKey(created.apiKey);
        toast.success(`Tenant “${created.tenant.tenantId}” created`);
      },
      onError: (err) => toast.error(getErrorMessage(err)),
    });
  };

  // Success state: the API key is shown exactly once.
  if (apiKey) {
    return (
      <PageLayout title="Tenant created" subtitle="Save the API key now — it can't be shown again.">
        <div className=" space-y-4">
          <SecretCallout
            value={apiKey}
            title="Tenant API key"
            note="Shown once — only a hash is stored. Hand it to the tenant for direct API access."
          />
          <div className="flex gap-2">
            <Button onClick={() => router.push("/tenants")}>Back to tenants</Button>
            <Button
              variant="outline"
              onClick={() => {
                setApiKey(null);
                setS(empty);
              }}
            >
              Create another
            </Button>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="New tenant" subtitle="Provision an organization, its portal owner, and a subscription.">
      <div className=" space-y-6">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => router.push("/tenants")}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <section className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">Tenant details</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" hint="Name displayed for this tenant">
              <Input
                value={s.name}
                placeholder="Acme Inc."
                onChange={(e) => setS((p) => ({ ...p, name: e.target.value, tenantId: toSlug(e.target.value) }))}
              />
            </Field>
            <Field label="Tenant ID" hint="Auto-derived from name">
              <Input value={s.tenantId} placeholder="acme-inc" readOnly />
            </Field>
            <Field label="Rate limit /min" hint="Optional; blank = default">
              <Input
                inputMode="numeric"
                value={s.rateLimit}
                placeholder="60"
                onChange={(e) => set("rateLimit", e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Allowed functions"
            hint={
              s.allowedFunctions.length === 0
                ? "None selected = all functions allowed."
                : `${s.allowedFunctions.length} selected`
            }
          >
            {functions.isPending ? (
              <p className="text-xs text-muted-foreground">Loading functions…</p>
            ) : functions.isError ? (
              <p className="text-xs text-destructive">{getErrorMessage(functions.error)}</p>
            ) : (
              <ToggleList options={functions.data?.functions ?? []} selected={s.allowedFunctions} onToggle={toggleFn} />
            )}
          </Field>
          <Field label="Allowed origins" hint="Optional; one per line or comma-separated (browser origins).">
            <Textarea
              value={s.allowedOrigins}
              rows={2}
              placeholder="https://app.acme.com"
              onChange={(e) => set("allowedOrigins", e.target.value)}
            />
          </Field>
        </section>
        <section className="space-y-3 rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Portal owner</p>
            <p className="text-xs text-muted-foreground">
              Optional — the first login so the org can sign in at <code>/login</code>. Leave blank for an API-only
              tenant.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Owner name">
              <Input
                value={s.ownerName}
                placeholder="Ada Lovelace"
                onChange={(e) => set("ownerName", e.target.value)}
              />
            </Field>
            <Field label="Owner email">
              <Input
                type="email"
                value={s.ownerEmail}
                placeholder="ada@acme.com"
                onChange={(e) => set("ownerEmail", e.target.value)}
              />
            </Field>
            <Field label="Temp password" hint="Min 8 characters">
              <Input
                type="password"
                autoComplete="new-password"
                value={s.ownerPassword}
                onChange={(e) => set("ownerPassword", e.target.value)}
              />
            </Field>
          </div>
        </section>
        <section className="space-y-3 rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Subscription</p>
            <p className="text-xs text-muted-foreground">
              Optional — pick a plan (its trial and limits apply). Blank = unlimited defaults.
            </p>
          </div>
          {plans.isError ? (
            <p className="text-xs text-destructive">{getErrorMessage(plans.error)}</p>
          ) : (plans.data?.items.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">
              No plans in the catalog yet — create one under Subscription Plans.
            </p>
          ) : (
            <Field label="Plan">
              <SelectOption
                className="sm:w-72"
                aria-label="Plan"
                value={s.planId || NO_PLAN}
                onValueChange={(v) => set("planId", v === NO_PLAN ? "" : v)}
                options={[
                  { label: "No subscription (unlimited defaults)", value: NO_PLAN },
                  ...(plans.data?.items ?? []).map((p) => ({
                    label: p.hidden ? `${p.name} (${p.tier}) · admin-only` : `${p.name} (${p.tier})`,
                    value: p.id,
                  })),
                ]}
              />
              {s.planId && (plans.data?.items ?? []).find((p) => p.id === s.planId)?.hidden && (
                <p className="text-xs text-muted-foreground">
                  Enterprise plan — custom pricing, not visible to tenants in self-serve.
                </p>
              )}
            </Field>
          )}
        </section>
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button onClick={submit} disabled={onboard.isPending}>
            {onboard.isPending ? <Loader className="animate-spin" /> : "Create tenant"}
          </Button>
          <Button variant="ghost" onClick={() => router.push("/tenants")} disabled={onboard.isPending}>
            Cancel
          </Button>
        </div>
      </div>
    </PageLayout>
  );
};

export default Page;
