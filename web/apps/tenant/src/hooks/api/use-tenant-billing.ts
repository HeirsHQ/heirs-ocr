import { useQuery } from "@tanstack/react-query";

import { http, unwrap } from "@heirs/api-client";
import type { TenantBilling } from "@/types/subscription";

const BILLING = ["tenant", "billing"];

export function useTenantBilling() {
  return useQuery({
    queryKey: BILLING,
    queryFn: () => http.get<TenantBilling>("/api/tenant/billing").then(unwrap),
    retry: false,
  });
}
