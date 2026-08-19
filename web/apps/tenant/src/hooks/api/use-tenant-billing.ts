import { useQuery } from "@tanstack/react-query";

import { http, unwrap } from "@heirs/api-client";
import { tenantKeys } from "./query-keys";
import type { TenantBilling } from "@/types/subscription";

export function useTenantBilling() {
  return useQuery({
    queryKey: tenantKeys.billing,
    queryFn: () => http.get<TenantBilling>("/api/tenant/billing").then(unwrap),
    retry: false,
  });
}
