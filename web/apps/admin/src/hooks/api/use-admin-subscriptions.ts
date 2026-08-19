import { useQuery } from "@tanstack/react-query";

import { http, unwrap, type Paginated, type PaginatedParams, type SubscriptionSummary } from "@heirs/api-client";
import { adminKeys } from "./query-keys";
import type { Subscription } from "@/types/subscription";

/**
 * Cross-tenant subscription reads for the `/subscriptions` console page.
 *
 * Per-tenant reads and plan assignment live in `use-admin-tenants.ts`
 * (`useTenantSubscription` / `useAssignSubscription`), keyed per tenant — this file
 * deliberately does not restate them, so there is one hook per endpoint rather than
 * two same-named hooks with different signatures.
 */

/** Every tenant's subscription, most recently updated first. */
export function useSubscriptions(params?: PaginatedParams) {
  return useQuery({
    queryKey: adminKeys.subscriptionList(params),
    queryFn: () => http.get<Paginated<Subscription>>("/api/admin/subscriptions", params).then(unwrap),
    retry: false,
  });
}

/**
 * Estate-wide totals for the stat tiles.
 *
 * Separate from {@link useSubscriptions} on purpose: the tiles describe every
 * enrolment while the table shows a page, and conflating them is what forced the
 * page to download the entire catalog just to render 25 rows.
 */
export function useSubscriptionSummary() {
  return useQuery({
    queryKey: adminKeys.subscriptionSummary,
    queryFn: () => http.get<SubscriptionSummary>("/api/admin/subscriptions/summary").then(unwrap),
    retry: false,
  });
}
