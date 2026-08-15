import type { Plan } from "./plan";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "expired" | "suspended";

export type PaymentProvider = "paystack" | "flutterwave" | "stripe" | "manual";

export interface PaymentBinding {
  provider: PaymentProvider;
  customerRef?: string;
  providerSubscriptionRef?: string;
  hasPaymentMethod: boolean;
}

export interface PeriodUsage {
  documentsProcessed: number;
  pagesProcessed: number;
  tokensUsed: number;
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
  id: string;
  tenantId: string;
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

export interface TenantUsage {
  tenantId: string;
  requests: number;
  errors: number;
  tokens: number;
}

export interface TenantBilling {
  subscription: Subscription | null;
  usage: TenantUsage;
}
