import { useQuery } from "@tanstack/react-query";

import { http, unwrap } from "@heirs/api-client";
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
export function useSubscriptions() {
  return useQuery({
    queryKey: ["admin", "subscriptions"],
    queryFn: () => http.get<{ subscriptions: Subscription[] }>("/api/admin/subscriptions").then(unwrap),
    retry: false,
  });
}
