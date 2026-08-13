import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { http, unwrap } from "@heirs/api-client";
import type { Plan, PlanInput } from "@/types/plan";

/**
 * Admin plan-catalog CRUD, via the admin BFF proxy (`/api/admin/*` → backend
 * `/admin/api/*`). The catalog is the source of truth for what a subscription can be
 * assigned from (see the `assignablePlan` guard) and what each tier unlocks.
 */

const PLANS = ["admin", "plans"];

export function usePlans() {
  return useQuery({
    queryKey: PLANS,
    queryFn: () => http.get<{ plans: Plan[] }>("/api/admin/plans").then(unwrap),
    retry: false,
  });
}

/** Registered OCR function keys, for the plan's `allowedFunctions` picker. */
export function useOcrFunctionKeys() {
  return useQuery({
    queryKey: ["admin", "functions"],
    queryFn: () => http.get<{ functions: string[] }>("/api/admin/functions").then(unwrap),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "plans", "create"],
    mutationFn: (plan: PlanInput) => http.post<{ plan: Plan }>("/api/admin/plans", plan).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: PLANS }),
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "plans", "update"],
    mutationFn: (plan: PlanInput) => http.put<{ plan: Plan }>(`/api/admin/plans/${plan.id}`, plan).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: PLANS }),
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["admin", "plans", "delete"],
    mutationFn: (id: string) => http.delete(`/api/admin/plans/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: PLANS }),
  });
}
