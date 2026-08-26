import { randomUUID } from "crypto";

import { endpointsForEvent, enqueueDelivery } from "./store";
import type { DocumentEventPayload, WebhookEvent } from "./events";
import { tenantHasFeature } from "../billing/feature-access";
import { isRecordable } from "../observability/documents";
import type { Sensitivity } from "../functions/define";
import { logger } from "../observability/logger";

/**
 * Turns a domain event into queued deliveries — one per subscribed endpoint.
 *
 * This only *writes rows*; nothing is sent here. The pipeline calls it on the
 * response path, so it must not do network I/O: a slow or hanging receiver would
 * otherwise add its latency to the OCR request that triggered it. The worker
 * (src/webhooks/deliver.ts) drains the outbox.
 */

/**
 * Fires a document lifecycle event.
 *
 * Fire-and-forget in the same sense as the usage counters: a webhook that cannot be
 * queued must never fail the OCR request that produced it.
 */
export const dispatchDocumentEvent = async (input: {
  tenantId: string;
  functionKey: string;
  sensitivity: Sensitivity;
  outcome: "success" | "error";
  pageCount: number;
  fileName: string;
  documentId?: string;
  requestId?: string;
  error?: { code: string; message: string };
}): Promise<void> => {
  const event: WebhookEvent = input.outcome === "success" ? "document.processed" : "document.failed";

  try {
    // Plans that do not include webhooks do not get them. Checked here rather than
    // only at registration, because registration is not where entitlement stops being
    // true: a tenant who downgrades keeps their endpoint rows, and without this the
    // events would keep flowing to a plan that no longer pays for them. Resolution is
    // cached (src/billing/subscriptions.ts), so this is not a query per document.
    if (!(await tenantHasFeature(input.tenantId, "webhooks"))) return;

    const endpoints = await endpointsForEvent(input.tenantId, event);
    if (endpoints.length === 0) return;

    const occurredAt = new Date().toISOString();
    await Promise.all(
      endpoints.map(async (endpoint) => {
        const deliveryId = randomUUID();
        const payload: DocumentEventPayload = {
          event,
          deliveryId,
          tenantId: input.tenantId,
          documentId: input.documentId,
          functionKey: input.functionKey,
          outcome: input.outcome,
          pageCount: input.pageCount,
          // Withheld for pii/restricted functions — the same rule the registry
          // applies, and it binds harder here: this leaves for a third-party URL.
          fileName: isRecordable(input.sensitivity) ? input.fileName : undefined,
          requestId: input.requestId,
          error: input.error,
          occurredAt,
        };
        await enqueueDelivery({
          id: deliveryId,
          endpointId: endpoint.id,
          tenantId: input.tenantId,
          event,
          payload,
        });
      }),
    );
  } catch (err) {
    logger.warn("webhook.dispatch.failed", {
      tenantId: input.tenantId,
      event,
      err: err instanceof Error ? err.message : String(err),
    });
  }
};
