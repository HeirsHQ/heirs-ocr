"use client";

import { useState, type ReactNode } from "react";
import { Loader } from "lucide-react";
import { toast } from "sonner";

import { useCreatePlan, useOcrFunctionKeys, useUpdatePlan } from "@/hooks/api/use-admin-plans";
import { Checkbox } from "@heirs/ui";
import { Textarea } from "@heirs/ui";
import { ToggleList } from "@/components/shared";
import { Button } from "@heirs/ui";
import { Switch } from "@heirs/ui";
import { getErrorMessage } from "@heirs/api-client";
import { Input } from "@heirs/ui";
import { cn } from "@heirs/ui";
import {
  BILLING_KINDS,
  CURRENCIES,
  FEATURES,
  PLAN_TIERS,
  SENSITIVITIES,
  type BillingKind,
  type BillingModel,
  type CurrencyCode,
  type Entitlements,
  type Feature,
  type Money,
  type Plan,
  type PlanInput,
  type PlanTier,
  type Sensitivity,
  type TrialPolicy,
} from "@/types/plan";

const selectClass = cn(
  "h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
);
const MB = 1024 * 1024;

interface FormState {
  id: string;
  name: string;
  description: string;
  tier: PlanTier;
  hidden: boolean;
  currency: CurrencyCode;
  billingKind: BillingKind;
  unitPrice: string;
  perPageSurcharge: string;
  minimumCharge: string;
  basePrice: string;
  overageUnitPrice: string;
  includedDocuments: string;
  includedUnlimited: boolean;
  maxSensitivity: Sensitivity;
  features: Feature[];
  allowedFunctions: string[];
  limDocsPerPeriod: string;
  limMaxPages: string;
  limMaxFileMB: string;
  limRatePerMin: string;
  limMaxConcurrent: string;
  limRetentionDays: string;
  trialEnabled: boolean;
  trialDurationDays: string;
  trialIncludedDocs: string;
  trialMaxPages: string;
  trialMaxFileMB: string;
  trialRequiresPayment: boolean;
}

const emptyState = (): FormState => ({
  id: "",
  name: "",
  description: "",
  tier: "starter",
  hidden: false,
  currency: "NGN",
  billingKind: "monthly",
  unitPrice: "",
  perPageSurcharge: "",
  minimumCharge: "",
  basePrice: "",
  overageUnitPrice: "",
  includedDocuments: "",
  includedUnlimited: false,
  maxSensitivity: "standard",
  features: [],
  allowedFunctions: [],
  limDocsPerPeriod: "",
  limMaxPages: "",
  limMaxFileMB: "",
  limRatePerMin: "",
  limMaxConcurrent: "",
  limRetentionDays: "30",
  trialEnabled: false,
  trialDurationDays: "",
  trialIncludedDocs: "",
  trialMaxPages: "",
  trialMaxFileMB: "",
  trialRequiresPayment: false,
});

const major = (m: Money): string => String(m.amountMinor / 100);
const mb = (bytes: number): string => String(bytes / MB);

const planToState = (p: Plan): FormState => {
  const b = p.billing;
  const currency: CurrencyCode =
    b.kind === "per_document" ? b.unitPrice.currency : b.kind === "monthly" ? b.basePrice.currency : "NGN";
  return {
    ...emptyState(),
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    tier: p.tier,
    hidden: p.hidden ?? false,
    currency,
    billingKind: b.kind,
    unitPrice: b.kind === "per_document" ? major(b.unitPrice) : "",
    perPageSurcharge: b.kind === "per_document" && b.perPageSurcharge ? major(b.perPageSurcharge) : "",
    minimumCharge: b.kind === "per_document" && b.minimumCharge ? major(b.minimumCharge) : "",
    basePrice: b.kind === "monthly" ? major(b.basePrice) : "",
    overageUnitPrice: b.kind === "monthly" && b.overageUnitPrice ? major(b.overageUnitPrice) : "",
    includedDocuments: b.kind === "monthly" && b.includedDocuments !== null ? String(b.includedDocuments) : "",
    includedUnlimited: b.kind === "monthly" && b.includedDocuments === null,
    maxSensitivity: p.entitlements.maxSensitivity,
    features: p.entitlements.features,
    allowedFunctions: p.entitlements.allowedFunctions,
    limDocsPerPeriod: p.entitlements.limits.documentsPerPeriod?.toString() ?? "",
    limMaxPages: p.entitlements.limits.maxPagesPerDocument?.toString() ?? "",
    limMaxFileMB: p.entitlements.limits.maxFileSizeBytes !== null ? mb(p.entitlements.limits.maxFileSizeBytes) : "",
    limRatePerMin: p.entitlements.limits.rateLimitPerMinute?.toString() ?? "",
    limMaxConcurrent: p.entitlements.limits.maxConcurrentJobs?.toString() ?? "",
    limRetentionDays: String(p.entitlements.limits.dataRetentionDays),
    trialEnabled: !!p.trial,
    trialDurationDays: p.trial?.durationDays?.toString() ?? "",
    trialIncludedDocs: p.trial?.includedDocuments?.toString() ?? "",
    trialMaxPages: p.trial?.maxPagesPerDocument?.toString() ?? "",
    trialMaxFileMB: p.trial?.maxFileSizeBytes !== undefined ? mb(p.trial.maxFileSizeBytes) : "",
    trialRequiresPayment: p.trial?.requiresPaymentMethod ?? false,
  };
};

const buildPayload = (s: FormState): { ok: true; plan: PlanInput } | { ok: false; error: string } => {
  try {
    const reqMoney = (v: string, label: string): Money => {
      const t = v.trim();
      if (t === "") throw new Error(`${label} is required`);
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a non-negative amount`);
      return { amountMinor: Math.round(n * 100), currency: s.currency };
    };
    const optMoney = (v: string, label: string): Money | undefined =>
      v.trim() === "" ? undefined : reqMoney(v, label);
    const nullableInt = (v: string, label: string): number | null => {
      const t = v.trim();
      if (t === "") return null;
      const n = Number(t);
      if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a non-negative whole number`);
      return n;
    };
    const optPosInt = (v: string, label: string): number | undefined => {
      const t = v.trim();
      if (t === "") return undefined;
      const n = Number(t);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} must be a positive whole number`);
      return n;
    };
    const nullableBytes = (v: string, label: string): number | null => {
      const t = v.trim();
      if (t === "") return null;
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a non-negative number`);
      return Math.round(n * MB);
    };

    const id = s.id.trim();
    if (!id) throw new Error("Plan ID is required");
    const name = s.name.trim();
    if (!name) throw new Error("Name is required");

    let billing: BillingModel;
    if (s.billingKind === "trial") {
      billing = { kind: "trial" };
    } else if (s.billingKind === "per_document") {
      billing = {
        kind: "per_document",
        unitPrice: reqMoney(s.unitPrice, "Unit price"),
        perPageSurcharge: optMoney(s.perPageSurcharge, "Per-page surcharge"),
        minimumCharge: optMoney(s.minimumCharge, "Minimum charge"),
      };
    } else {
      let includedDocuments: number | null;
      if (s.includedUnlimited) {
        includedDocuments = null;
      } else {
        const t = s.includedDocuments.trim();
        if (t === "") throw new Error("Included documents is required (or mark unlimited)");
        const n = Number(t);
        if (!Number.isInteger(n) || n < 0) throw new Error("Included documents must be a non-negative whole number");
        includedDocuments = n;
      }
      billing = {
        kind: "monthly",
        basePrice: reqMoney(s.basePrice, "Base price"),
        includedDocuments,
        overageUnitPrice: optMoney(s.overageUnitPrice, "Overage unit price"),
      };
    }

    const retentionN = Number(s.limRetentionDays.trim() || "0");
    if (!Number.isInteger(retentionN) || retentionN < 0)
      throw new Error("Data retention days must be a non-negative whole number");

    const entitlements: Entitlements = {
      allowedFunctions: s.allowedFunctions,
      maxSensitivity: s.maxSensitivity,
      features: s.features,
      limits: {
        documentsPerPeriod: nullableInt(s.limDocsPerPeriod, "Documents per period"),
        maxPagesPerDocument: nullableInt(s.limMaxPages, "Max pages per document"),
        maxFileSizeBytes: nullableBytes(s.limMaxFileMB, "Max file size"),
        rateLimitPerMinute: nullableInt(s.limRatePerMin, "Rate limit per minute"),
        maxConcurrentJobs: nullableInt(s.limMaxConcurrent, "Max concurrent jobs"),
        dataRetentionDays: retentionN,
      },
    };

    let trial: TrialPolicy | undefined;
    if (s.trialEnabled) {
      trial = {
        durationDays: optPosInt(s.trialDurationDays, "Trial duration days"),
        includedDocuments: optPosInt(s.trialIncludedDocs, "Trial included documents"),
        maxPagesPerDocument: optPosInt(s.trialMaxPages, "Trial max pages"),
        maxFileSizeBytes:
          s.trialMaxFileMB.trim() === ""
            ? undefined
            : (nullableBytes(s.trialMaxFileMB, "Trial max file size") ?? undefined),
        requiresPaymentMethod: s.trialRequiresPayment,
      };
    }

    return {
      ok: true,
      plan: {
        id,
        name,
        tier: s.tier,
        description: s.description.trim() || undefined,
        billing,
        entitlements,
        trial,
        hidden: s.hidden || undefined,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid plan" };
  }
};

const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="space-y-1">
    <label className="text-sm font-medium">{label}</label>
    {children}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

const NumberInput = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) => <Input inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;

/** Create/edit form for a catalog plan. `initial` undefined = create. `onDone` fires after save/cancel. */
export const PlanForm = ({ initial, onDone }: { initial?: Plan; onDone: () => void }) => {
  const isEdit = !!initial;
  const [s, setS] = useState<FormState>(() => (initial ? planToState(initial) : emptyState()));
  const [error, setError] = useState<string | null>(null);
  const functions = useOcrFunctionKeys();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const pending = createPlan.isPending || updatePlan.isPending;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const toggle = (key: "features" | "allowedFunctions", value: string) =>
    setS((prev) => {
      const arr = prev[key] as string[];
      return { ...prev, [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] };
    });

  const submit = () => {
    setError(null);
    const built = buildPayload(s);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    const mutation = isEdit ? updatePlan : createPlan;
    mutation.mutate(built.plan, {
      onSuccess: () => {
        toast.success(isEdit ? "Plan updated" : `Plan “${built.plan.name}” created`);
        onDone();
      },
      onError: (err) => toast.error(getErrorMessage(err)),
    });
  };

  return (
    <div className="space-y-5">
      {/* Basics */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Plan ID" hint={isEdit ? "Immutable" : "Lowercase slug, e.g. starter"}>
          <Input value={s.id} disabled={isEdit} placeholder="starter" onChange={(e) => set("id", e.target.value)} />
        </Field>
        <Field label="Name">
          <Input value={s.name} placeholder="Starter" onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Tier">
          <select className={selectClass} value={s.tier} onChange={(e) => set("tier", e.target.value as PlanTier)}>
            {PLAN_TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Currency">
          <select
            className={selectClass}
            value={s.currency}
            onChange={(e) => set("currency", e.target.value as CurrencyCode)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Description" hint="Shown in the console and self-serve UI.">
        <Textarea value={s.description} rows={2} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={s.hidden} onCheckedChange={(v) => set("hidden", v)} />
        Hidden from self-serve signup (bespoke/enterprise)
      </label>

      {/* Billing */}
      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Billing</p>
        <Field label="Model">
          <select
            className={selectClass}
            value={s.billingKind}
            onChange={(e) => set("billingKind", e.target.value as BillingKind)}
          >
            {BILLING_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>

        {s.billingKind === "per_document" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={`Unit price (${s.currency})`}>
              <NumberInput value={s.unitPrice} onChange={(v) => set("unitPrice", v)} placeholder="25" />
            </Field>
            <Field label="Per-page surcharge" hint="Optional">
              <NumberInput value={s.perPageSurcharge} onChange={(v) => set("perPageSurcharge", v)} placeholder="5" />
            </Field>
            <Field label="Minimum charge" hint="Optional">
              <NumberInput value={s.minimumCharge} onChange={(v) => set("minimumCharge", v)} placeholder="25" />
            </Field>
          </div>
        )}

        {s.billingKind === "monthly" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={`Base price (${s.currency})`}>
              <NumberInput value={s.basePrice} onChange={(v) => set("basePrice", v)} placeholder="25000" />
            </Field>
            <Field label="Included documents" hint={s.includedUnlimited ? "Unlimited" : "Per billing period"}>
              <div className="flex items-center gap-2">
                <Input
                  inputMode="numeric"
                  value={s.includedDocuments}
                  disabled={s.includedUnlimited}
                  placeholder="2000"
                  onChange={(e) => set("includedDocuments", e.target.value)}
                />
                <label className="flex shrink-0 items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={s.includedUnlimited}
                    onCheckedChange={(v: boolean) => set("includedUnlimited", v)}
                  />
                  ∞
                </label>
              </div>
            </Field>
            <Field label="Overage unit price" hint="Optional; omit to hard-stop">
              <NumberInput value={s.overageUnitPrice} onChange={(v) => set("overageUnitPrice", v)} placeholder="15" />
            </Field>
          </div>
        )}
        {s.billingKind === "trial" && (
          <p className="text-xs text-muted-foreground">Free — no charge model. Configure the trial window below.</p>
        )}
      </div>

      {/* Entitlements */}
      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Entitlements</p>
        <Field label="Max sensitivity" hint="Gates PII/restricted functions.">
          <select
            className={cn(selectClass, "sm:w-48")}
            value={s.maxSensitivity}
            onChange={(e) => set("maxSensitivity", e.target.value as Sensitivity)}
          >
            {SENSITIVITIES.map((sv) => (
              <option key={sv} value={sv}>
                {sv}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Features">
          <ToggleList options={FEATURES} selected={s.features} onToggle={(v) => toggle("features", v)} />
        </Field>
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
            <ToggleList
              options={functions.data?.functions ?? []}
              selected={s.allowedFunctions}
              onToggle={(v) => toggle("allowedFunctions", v)}
            />
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Docs / period" hint="Blank = unlimited">
            <NumberInput value={s.limDocsPerPeriod} onChange={(v) => set("limDocsPerPeriod", v)} placeholder="∞" />
          </Field>
          <Field label="Max pages / doc" hint="Blank = per-function">
            <NumberInput value={s.limMaxPages} onChange={(v) => set("limMaxPages", v)} placeholder="50" />
          </Field>
          <Field label="Max file size (MB)" hint="Blank = default">
            <NumberInput value={s.limMaxFileMB} onChange={(v) => set("limMaxFileMB", v)} placeholder="15" />
          </Field>
          <Field label="Rate limit / min" hint="Blank = default">
            <NumberInput value={s.limRatePerMin} onChange={(v) => set("limRatePerMin", v)} placeholder="60" />
          </Field>
          <Field label="Max concurrent jobs" hint="Blank = unbounded">
            <NumberInput value={s.limMaxConcurrent} onChange={(v) => set("limMaxConcurrent", v)} placeholder="5" />
          </Field>
          <Field label="Data retention (days)">
            <NumberInput value={s.limRetentionDays} onChange={(v) => set("limRetentionDays", v)} placeholder="90" />
          </Field>
        </div>
      </div>

      {/* Trial */}
      <div className="space-y-3 rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch checked={s.trialEnabled} onCheckedChange={(v) => set("trialEnabled", v)} />
          Include a trial when a tenant starts on this plan
        </label>
        {s.trialEnabled && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Duration (days)" hint="Optional">
                <NumberInput
                  value={s.trialDurationDays}
                  onChange={(v) => set("trialDurationDays", v)}
                  placeholder="14"
                />
              </Field>
              <Field label="Included docs" hint="Optional">
                <NumberInput
                  value={s.trialIncludedDocs}
                  onChange={(v) => set("trialIncludedDocs", v)}
                  placeholder="50"
                />
              </Field>
              <Field label="Max pages / doc" hint="Optional">
                <NumberInput value={s.trialMaxPages} onChange={(v) => set("trialMaxPages", v)} placeholder="10" />
              </Field>
              <Field label="Max file (MB)" hint="Optional">
                <NumberInput value={s.trialMaxFileMB} onChange={(v) => set("trialMaxFileMB", v)} placeholder="10" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={s.trialRequiresPayment} onCheckedChange={(v) => set("trialRequiresPayment", v)} />
              Requires a payment method up front
            </label>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? <Loader className="animate-spin" /> : isEdit ? "Save changes" : "Create plan"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
};
