import { KeyRound, Power, Send, Trash2 } from "lucide-react";

import type { WebhookDelivery, WebhookEndpoint } from "@heirs/api-client";

import { createColumns, DateTimeCell, NumberCell, StatusCell, TextCell } from "./core";

interface EndpointHandlers {
  /**
   * Whether the org's plan includes webhooks. Mirrors the server, which gates test,
   * update and rotate-secret behind `requireTenantFeature("webhooks")` but leaves
   * delete open (src/http/tenant/routes.ts) — a tenant who downgrades has to be able
   * to take their endpoints down. Offering the gated three anyway would put three
   * menu items on screen whose only outcome is a 403 toast.
   */
  entitled: boolean;
  onTest: (endpoint: WebhookEndpoint) => void;
  onRotate: (endpoint: WebhookEndpoint) => void;
  onToggle: (endpoint: WebhookEndpoint) => void;
  onDelete: (endpoint: WebhookEndpoint) => void;
}

export function createWebhookColumns({ entitled, onTest, onRotate, onToggle, onDelete }: EndpointHandlers) {
  return createColumns<WebhookEndpoint>({
    columns: [
      {
        accessorKey: "url",
        header: "Endpoint",
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-mono text-xs">{row.original.url}</p>
            {row.original.description && (
              <p className="truncate text-xs text-muted-foreground">{row.original.description}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: "events",
        header: "Events",
        cell: ({ row }) => <TextCell value={row.original.events.join(", ")} />,
      },
      {
        accessorKey: "enabled",
        header: "Status",
        cell: ({ row }) => (
          <StatusCell
            status={row.original.enabled ? "active" : "disabled"}
            config={{ active: "success", disabled: "neutral" }}
            default="neutral"
          />
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        cell: ({ row }) => <DateTimeCell date={row.original.createdAt ?? null} />,
      },
    ],
    actions: (endpoint) => [
      { label: "Send test event", icon: Send, hidden: !entitled, onClick: () => onTest(endpoint) },
      {
        label: endpoint.enabled ? "Disable" : "Enable",
        icon: Power,
        hidden: !entitled,
        onClick: () => onToggle(endpoint),
      },
      {
        label: "Rotate secret",
        icon: KeyRound,
        variant: "warning",
        hidden: !entitled,
        onClick: () => onRotate(endpoint),
      },
      { label: "Delete", icon: Trash2, variant: "destructive", onClick: () => onDelete(endpoint) },
    ],
  });
}

/**
 * The delivery log.
 *
 * `pending` is deliberately amber rather than neutral: it means "still retrying",
 * which is a state someone debugging a receiver needs to notice, not a resting one.
 */
export function createDeliveryColumns() {
  return createColumns<WebhookDelivery>({
    columns: [
      {
        accessorKey: "event",
        header: "Event",
        cell: ({ row }) => <TextCell value={row.original.event} />,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusCell
            status={row.original.status}
            config={{ succeeded: "success", dead: "danger", pending: "warning" }}
            default="neutral"
          />
        ),
      },
      {
        accessorKey: "attempts",
        header: "Attempts",
        cell: ({ row }) => <NumberCell value={row.original.attempts} />,
      },
      {
        accessorKey: "responseStatus",
        header: "Response",
        cell: ({ row }) => <TextCell value={row.original.responseStatus?.toString() ?? "—"} />,
      },
      {
        id: "detail",
        header: "Detail",
        cell: ({ row }) =>
          row.original.lastError ? (
            <span className="text-destructive text-xs">{row.original.lastError}</span>
          ) : (
            <TextCell value="—" />
          ),
      },
      {
        accessorKey: "createdAt",
        header: "Queued",
        cell: ({ row }) => <DateTimeCell date={row.original.createdAt ?? null} />,
      },
    ],
  });
}
