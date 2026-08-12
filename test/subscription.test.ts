import { describe, expect, it } from "vitest";

import {
  canUseFunction,
  checkDocumentQuota,
  effectiveLimits,
  effectiveStatus,
  quoteDocument,
  requireActive,
  resolveTrialWindow,
} from "../src/billing/entitlements";
import { getPlan } from "../src/billing/plans";
import { assignablePlan, createSubscriptionFromPlan } from "../src/billing/subscriptions";
import { evaluateSubscription } from "../src/http/middleware/require-subscription";
import { OcrFunction } from "../src/functions/define";
import type { Subscription } from "../src/types/subscription";

const T0 = new Date("2026-08-10T00:00:00Z");

/** Build a live subscription from a catalog plan; override any field. */
const makeSub = (planId: string, over: Partial<Subscription> = {}): Subscription => {
  const plan = getPlan(planId)!;
  const trial = plan.trial ? resolveTrialWindow(plan.trial, T0) : undefined;
  return {
    id: "sub_test",
    tenantId: "tenant_test",
    plan,
    status: trial ? "trialing" : "active",
    trial,
    currentPeriodStart: T0,
    currentPeriodEnd: new Date(T0.getTime() + 30 * 86_400_000),
    cancelAtPeriodEnd: false,
    usage: { documentsProcessed: 0, pagesProcessed: 0, tokensUsed: 0, amountAccruedMinor: 0 },
    payment: { provider: "paystack", hasPaymentMethod: false },
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
};

/** A monthly plan with an included allowance but NO overage → hard-stops on quota. */
const monthlyNoOverageSub = (over: Partial<Subscription> = {}): Subscription => {
  const base = getPlan("starter")!;
  const plan = {
    ...base,
    trial: undefined,
    billing: {
      kind: "monthly" as const,
      basePrice: { amountMinor: 2_500_000, currency: "NGN" as const },
      includedDocuments: 2,
    },
  };
  return makeSub("starter", { plan, status: "active", trial: undefined, ...over });
};

describe("entitlements — pure guards", () => {
  it("serves an in-window trial and allows its standard functions", () => {
    const sub = makeSub("free_trial");
    expect(requireActive(sub, T0).allowed).toBe(true);
    expect(canUseFunction(sub, OcrFunction.TEXT_EXTRACTION).allowed).toBe(true);
  });

  it("blocks a function the plan does not include", () => {
    const sub = makeSub("free_trial"); // no ID_VERIFICATION on the trial
    const decision = canUseFunction(sub, OcrFunction.ID_VERIFICATION, { sensitivity: "pii" });
    expect(decision.allowed).toBe(false);
  });

  it("allows a PII function on a plan whose ceiling permits it", () => {
    const sub = makeSub("business", { status: "active", trial: undefined });
    expect(canUseFunction(sub, OcrFunction.ID_VERIFICATION, { sensitivity: "pii" }).allowed).toBe(true);
  });

  it("hard-stops a paid request once the period allowance is spent (no overage)", () => {
    const sub = monthlyNoOverageSub({
      usage: { documentsProcessed: 2, pagesProcessed: 0, tokensUsed: 0, amountAccruedMinor: 0 },
    });
    expect(checkDocumentQuota(sub, T0)).toMatchObject({ allowed: false, code: "QUOTA_EXCEEDED" });
  });

  it("treats a spent no-payment free trial as expired (prompt to pay, not quota)", () => {
    const sub = makeSub("free_trial", { trial: { ...makeSub("free_trial").trial!, documentsRemaining: 0 } });
    expect(effectiveStatus(sub, T0)).toBe("expired");
    expect(requireActive(sub, T0).allowed).toBe(false);
  });

  it("prices a per-document plan with the per-page surcharge", () => {
    const sub = makeSub("payg"); // ₦25 base + ₦5/page
    const quote = quoteDocument(sub, 3, T0);
    expect(quote).toEqual({ amountMinor: 4000, currency: "NGN" }); // 2500 + 500*3
  });

  it("charges nothing for a monthly document within the included allowance", () => {
    const sub = makeSub("starter", { status: "active", trial: undefined });
    expect(quoteDocument(sub, 2, T0)).toBeNull();
  });

  it("applies the trial's tighter page/size caps while trialing", () => {
    const sub = makeSub("starter"); // paid tier: 50 pages; trial: 20 pages / 15 MB
    const limits = effectiveLimits(sub, T0);
    expect(limits.maxPagesPerDocument).toBe(20);
    expect(limits.maxFileSizeBytes).toBe(15 * 1024 * 1024);
  });

  it("resolves an elapsed no-payment trial to expired", () => {
    const sub = makeSub("free_trial", {
      trial: { ...makeSub("free_trial").trial!, endsAt: new Date(Date.now() - 1000) },
    });
    expect(effectiveStatus(sub)).toBe("expired");
    expect(requireActive(sub).allowed).toBe(false);
  });
});

describe("createSubscriptionFromPlan — enrol a tenant on a plan", () => {
  it("starts a trial-granting plan in 'trialing' with a resolved trial window", () => {
    const sub = createSubscriptionFromPlan("tenant_x", getPlan("free_trial")!, T0);
    expect(sub.tenantId).toBe("tenant_x");
    expect(sub.plan.id).toBe("free_trial");
    expect(sub.status).toBe("trialing");
    expect(sub.trial?.documentsRemaining).toBe(50);
    expect(sub.usage.documentsProcessed).toBe(0);
    expect(sub.currentPeriodEnd.getTime()).toBeGreaterThan(sub.currentPeriodStart.getTime());
  });

  it("starts a plan with no trial in 'active'", () => {
    // payg has no `trial` policy.
    const sub = createSubscriptionFromPlan("tenant_y", getPlan("payg")!, T0);
    expect(sub.status).toBe("active");
    expect(sub.trial).toBeUndefined();
  });
});

describe("evaluateSubscription — denial → HTTP mapping", () => {
  it("maps an inactive subscription to 402 PAYMENT_REQUIRED", () => {
    const sub = makeSub("business", { status: "suspended", trial: undefined });
    const err = evaluateSubscription(sub, OcrFunction.TEXT_EXTRACTION, "standard", T0);
    expect(err?.code).toBe("PAYMENT_REQUIRED");
    expect(err?.status).toBe(402);
  });

  it("maps a spent paid quota to 429 QUOTA_EXCEEDED (retryable)", () => {
    const sub = monthlyNoOverageSub({
      usage: { documentsProcessed: 2, pagesProcessed: 0, tokensUsed: 0, amountAccruedMinor: 0 },
    });
    const err = evaluateSubscription(sub, OcrFunction.TEXT_EXTRACTION, "standard", T0);
    expect(err?.code).toBe("QUOTA_EXCEEDED");
    expect(err?.status).toBe(429);
    expect(err?.retryable).toBe(true);
  });

  it("maps a not-entitled function to 403 FORBIDDEN", () => {
    const sub = makeSub("free_trial");
    const err = evaluateSubscription(sub, OcrFunction.ID_VERIFICATION, "pii", T0);
    expect(err?.code).toBe("FORBIDDEN");
    expect(err?.status).toBe(403);
  });

  it("allows a permitted request (null)", () => {
    const sub = makeSub("free_trial");
    expect(evaluateSubscription(sub, OcrFunction.TEXT_EXTRACTION, "standard", T0)).toBeNull();
  });
});

describe("assignablePlan (admin subscription guard)", () => {
  it("refuses assignment when the plan is not in the catalog", () => {
    expect(assignablePlan("ghost", undefined)).toEqual({
      ok: false,
      code: "PLAN_NOT_FOUND",
      reason: "No such plan 'ghost'",
    });
  });

  it("allows assignment for a plan that exists", () => {
    const plan = getPlan("starter")!;
    expect(assignablePlan("starter", plan)).toEqual({ ok: true, plan });
  });
});
