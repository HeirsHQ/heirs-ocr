import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { removeNullOrUndefined } from "@heirs/ui";
import { PaginatedParams } from "@/types/app";
import { http, unwrap } from "@heirs/api-client";

export function useSubscriptions(params?: PaginatedParams) {
  const _params = removeNullOrUndefined(params);

  return useQuery({
    queryKey: ["subscriptions", _params],
    queryFn: () => http.get("/api/subscriptions", _params).then(unwrap),
  });
}

export function useSubscription(id: string) {
  return useQuery({
    queryKey: ["subscriptions", id],
    queryFn: () => http.get(`/api/subscriptions/${id}`).then(unwrap),
    enabled: !!id,
  });
}

export function useCreateSubscription() {
  const qc = useQueryClient();

  return useMutation({
    mutationKey: ["create-subscription"],
    mutationFn: (payload: FormData) => http.post(`/api/subscriptions`, payload).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subscriptions"] }),
    onError: (error) => console.log(error),
  });
}

export function useUpdateSubscription() {}

export function useDeleteSubscription() {}
