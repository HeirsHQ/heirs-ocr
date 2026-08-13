"use client";

import { ArrowLeft, Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useOnboardTenant, type OnboardTenantPayload } from "@/hooks/api/use-admin-tenants";
import { PageLayout, SecretCallout, ToggleList } from "@/components/shared";
import { useOcrFunctionKeys, usePlans } from "@/hooks/api/use-admin-plans";
import { Textarea } from "@heirs/ui";
import { Button } from "@heirs/ui";
import { getErrorMessage } from "@heirs/api-client";
import { Input } from "@heirs/ui";
import { cn } from "@heirs/ui";

const selectClass = cn(
  "h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
);

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

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <label className="text-sm font-medium">{label}</label>
    {children}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

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
  const plans = usePlans();

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

        {/* Tenant details */}
        <section className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">Tenant details</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tenant ID" hint="Lowercase slug, e.g. acme">
              <Input value={s.tenantId} placeholder="acme" onChange={(e) => set("tenantId", e.target.value)} />
            </Field>
            <Field label="Display name" hint="Optional">
              <Input value={s.name} placeholder="Acme Inc." onChange={(e) => set("name", e.target.value)} />
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

        {/* Portal owner */}
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

        {/* Subscription */}
        <section className="space-y-3 rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Subscription</p>
            <p className="text-xs text-muted-foreground">
              Optional — pick a plan (its trial and limits apply). Blank = unlimited defaults.
            </p>
          </div>
          {plans.isError ? (
            <p className="text-xs text-destructive">{getErrorMessage(plans.error)}</p>
          ) : (plans.data?.plans.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">
              No plans in the catalog yet — create one under Subscriptions.
            </p>
          ) : (
            <Field label="Plan">
              <select
                className={cn(selectClass, "sm:w-72")}
                value={s.planId}
                onChange={(e) => set("planId", e.target.value)}
              >
                <option value="">No subscription (unlimited defaults)</option>
                {plans.data?.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.tier})
                  </option>
                ))}
              </select>
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
