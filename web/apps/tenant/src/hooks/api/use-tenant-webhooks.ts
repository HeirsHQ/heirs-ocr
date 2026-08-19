import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  http,
  unwrap,
  type Paginated,
  type PaginatedParams,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEndpointWithSecret,
  type WebhookEventName,
} from "@heirs/api-client";

import { invalidate, tenantKeys } from "./query-keys";

/**
 * Webhook endpoints and their delivery log (owner only).
 *
 * Creating and rotating both return the signing secret **once** — the caller must
 * surface it immediately, because it is unrecoverable afterwards.
 */
export function useWebhooks(params?: PaginatedParams) {
  return useQuery({
    queryKey: [...tenantKeys.webhooks, "list", params],
    queryFn: () => http.get<Paginated<WebhookEndpoint>>("/api/tenant/webhooks", params).then(unwrap),
    retry: false,
  });
}

export interface CreateWebhookPayload {
  url: string;
  description?: string;
  events: WebhookEventName[];
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "webhooks", "create"],
    mutationFn: (payload: CreateWebhookPayload) =>
      http.post<WebhookEndpointWithSecret>("/api/tenant/webhooks", payload).then(unwrap),
    onSuccess: () => invalidate(qc, [tenantKeys.webhooks]),
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "webhooks", "update"],
    mutationFn: ({ id, ...patch }: { id: string } & Partial<CreateWebhookPayload> & { enabled?: boolean }) =>
      http.patch<WebhookEndpoint>(`/api/tenant/webhooks/${id}`, patch).then(unwrap),
    onSuccess: () => invalidate(qc, [tenantKeys.webhooks]),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "webhooks", "delete"],
    mutationFn: (id: string) => http.delete(`/api/tenant/webhooks/${id}`).then(unwrap),
    onSuccess: () => invalidate(qc, [tenantKeys.webhooks]),
  });
}

export function useRotateWebhookSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "webhooks", "rotate"],
    mutationFn: (id: string) =>
      http.post<WebhookEndpointWithSecret>(`/api/tenant/webhooks/${id}/rotate-secret`, {}).then(unwrap),
    onSuccess: () => invalidate(qc, [tenantKeys.webhooks]),
  });
}

/** Queues a synthetic event so a receiver can be verified without a real document. */
export function useTestWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["tenant", "webhooks", "test"],
    mutationFn: (id: string) => http.post<{ deliveryId: string }>(`/api/tenant/webhooks/${id}/test`, {}).then(unwrap),
    onSuccess: () => invalidate(qc, [tenantKeys.webhookDeliveries]),
  });
}

export function useWebhookDeliveries(params?: PaginatedParams & { endpointId?: string }) {
  return useQuery({
    queryKey: [...tenantKeys.webhookDeliveries, params],
    queryFn: () => http.get<Paginated<WebhookDelivery>>("/api/tenant/webhooks/deliveries", params).then(unwrap),
    retry: false,
    // Deliveries settle in the worker, so this page changes without the user acting.
    refetchInterval: 10_000,
  });
}
