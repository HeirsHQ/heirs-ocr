/**
 * A tenant's live enrolment in a plan, mirroring the backend domain model
 * (`src/types/subscription.ts`). Distinct from `Plan` (types/plan.ts), which is the
 * catalog product: a subscription carries a **snapshot** of the plan it was created
 * under, so a later catalog price change never re-prices an existing tenant.
 *
 * Dates arrive as ISO strings over the wire (jsonb round-trip), not `Date`.
 */

import type { Plan } from "./plan";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "expired" | "suspended";

export type PaymentProvider = "paystack" | "flutterwave" | "stripe" | "manual";

export interface PaymentBinding {
  provider: PaymentProvider;
  customerRef?: string;
  providerSubscriptionRef?: string;
  hasPaymentMethod: boolean;
}

/** Usage accrued within the current billing period; reset at each period roll. */
export interface PeriodUsage {
  documentsProcessed: number;
  pagesProcessed: number;
  tokensUsed: number;
  /** Money accrued this period, in minor units (kobo/cents). */
  amountAccruedMinor: number;
}

export interface TrialWindow {
  startedAt: string;
  endsAt: string | null;
  documentsRemaining: number | null;
  maxPagesPerDocument: number | null;
  maxFileSizeBytes: number | null;
  endedAt?: string;
}

export interface Subscription {
  /**
   * What the system actually enforces right now, derived from the record's dates and
   * trial window. Diverges from `status` when time has passed without a billing tick
   * — a lapsed trial is still stored as `trialing` but enforced as `expired`. Render
   * this, not `status`, or the console contradicts what the API does.
   */
  effectiveStatus?: SubscriptionStatus;
  id: string;
  tenantId: string;
  /** Snapshot of the plan at enrolment time — not a live catalog reference. */
  plan: Plan;
  status: SubscriptionStatus;
  trial?: TrialWindow;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  canceledAt?: string;
  usage: PeriodUsage;
  payment: PaymentBinding;
  createdAt: string;
  updatedAt: string;
}
