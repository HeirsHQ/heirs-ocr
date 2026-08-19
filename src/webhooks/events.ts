/**
 * The events a tenant can subscribe a webhook endpoint to.
 *
 * A closed set, declared here rather than as free-form strings, so an endpoint
 * cannot be registered against an event that will never fire — a subscription that
 * silently never delivers is worse than a rejected one.
 */
export const WEBHOOK_EVENTS = ["document.processed", "document.failed"] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const isWebhookEvent = (value: string): value is WebhookEvent =>
  (WEBHOOK_EVENTS as readonly string[]).includes(value);

/**
 * The body delivered for a document event.
 *
 * `fileName` is **omitted for `pii`/`restricted` functions**, matching the document
 * registry's rule (src/observability/documents.ts). The reasoning is the same and
 * applies more strongly here: a filename is identifying on its own, and a webhook
 * sends it to an arbitrary third-party URL rather than merely storing it. The event
 * still fires — the tenant is told the document was processed, just not what it was
 * called.
 */
export type DocumentEventPayload = {
  event: WebhookEvent;
  /** Delivery-unique id; also sent as a header so receivers can dedupe on retries. */
  deliveryId: string;
  tenantId: string;
  /** The registry row, when one exists. Absent for pii/restricted runs. */
  documentId?: string;
  functionKey: string;
  outcome: "success" | "error";
  pageCount: number;
  fileName?: string;
  requestId?: string;
  error?: { code: string; message: string };
  /** ISO 8601, when the event occurred rather than when it is delivered. */
  occurredAt: string;
};
