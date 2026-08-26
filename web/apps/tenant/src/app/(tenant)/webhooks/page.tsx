"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader, Lock, Plus, Webhook } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  useCreateWebhook,
  useDeleteWebhook,
  useRotateWebhookSecret,
  useTestWebhook,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
} from "@/hooks/api/use-tenant-webhooks";
import { useTenantBilling } from "@/hooks/api/use-tenant-billing";
import { createDeliveryColumns, createWebhookColumns } from "@/config/columns/webhooks";
import { getErrorMessage, type WebhookEndpoint, type WebhookEventName } from "@heirs/api-client";
import { Button, Checkbox, cn, Dialog, DialogContent, Field, Input, usePagination } from "@heirs/ui";
import {
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  PageLayout,
  SecretCallout,
  Skeleton,
} from "@/components/shared";

const EVENTS: { value: WebhookEventName; label: string; hint: string }[] = [
  { value: "document.processed", label: "document.processed", hint: "A document finished successfully" },
  { value: "document.failed", label: "document.failed", hint: "A document could not be processed" },
];

/**
 * Mirrored from `MAX_ENDPOINTS_PER_TENANT` (src/webhooks/store.ts), which is where it
 * is actually enforced — the API answers 409 regardless of what this page believes.
 * It exists here only so the limit can be shown before the form is filled in and a
 * submission is spent finding out. If the two ever drift, the server wins and the
 * cost is a stale hint, not a wrong outcome.
 */
const ENDPOINT_LIMIT = 10;

/** Ties the disabled Add button to the on-screen sentence explaining why. */
const CAP_HINT_ID = "webhook-endpoint-cap";

/**
 * Shown when the org's plan does not include webhooks. Deliberately not a wall: the
 * list, the delivery log and delete all keep working (the API leaves them open), so a
 * tenant who downgrades can still see what they have and take it down. Hiding the
 * page would strand endpoints they can neither find nor remove.
 */
const PlanNotice = ({ planName }: { planName?: string }) => (
  <div className="border-hairline bg-card flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex items-start gap-3">
      <span className="bg-warning/10 text-warning flex size-8 shrink-0 items-center justify-center rounded-full">
        <Lock className="size-4" aria-hidden />
      </span>
      <div>
        <p className="text-sm font-semibold">Webhooks are on Business and Enterprise</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {planName ? `Your plan (${planName}) doesn't include webhooks.` : "Your plan doesn't include webhooks."} Any
          endpoints below have stopped receiving events, and stay here so you can remove them.
        </p>
      </div>
    </div>
    <Button variant="outline" className="shrink-0" render={<Link href="/billing">View plans</Link>} />
  </div>
);

const schema = z.object({
  url: z.string().min(1, "Required").url("Enter a full URL, e.g. https://example.com/hooks/ocr"),
  description: z.string().max(200).optional(),
});
type FormValues = z.infer<typeof schema>;

// ── Create ────────────────────────────────────────────────────────────────────

const CreateWebhook = ({ disabled = false, describedBy }: { disabled?: boolean; describedBy?: string }) => {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [events, setEvents] = useState<WebhookEventName[]>(["document.processed"]);
  const create = useCreateWebhook();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const close = () => {
    setOpen(false);
    setSecret(null);
    setEvents(["document.processed"]);
    reset({ url: "", description: "" });
  };

  const toggleEvent = (event: WebhookEventName) =>
    setEvents((current) => (current.includes(event) ? current.filter((e) => e !== event) : [...current, event]));

  const onCreate = handleSubmit(({ url, description }) => {
    if (events.length === 0) {
      toast.error("Subscribe to at least one event");
      return;
    }
    create.mutate(
      { url, description: description || undefined, events },
      {
        onSuccess: (endpoint) => setSecret(endpoint.secret),
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  });

  return (
    <>
      {/* A disabled control has to say why, and the reason lives next to the table
          rather than in this corner of the header — so point at it instead of
          repeating it. */}
      <Button onClick={() => setOpen(true)} disabled={disabled} aria-describedby={disabled ? describedBy : undefined}>
        <Plus className="size-4" />
        Add endpoint
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent
          title="Add webhook endpoint"
          description={secret ? undefined : "We'll POST signed events to this URL as documents are processed."}
        >
          {secret ? (
            <div className="space-y-3">
              <SecretCallout
                value={secret}
                title="Copy your signing secret now"
                note="Shown once. Use it to verify the X-Heirs-Signature header on every delivery."
              />
              <div className="flex justify-end">
                <Button onClick={close}>Done</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={onCreate} className="space-y-3" noValidate>
              <Field label="Endpoint URL" htmlFor="hook-url" error={errors.url?.message}>
                <Input id="hook-url" placeholder="https://example.com/hooks/ocr" {...register("url")} />
              </Field>
              <Field label="Description (optional)" htmlFor="hook-desc">
                <Input id="hook-desc" placeholder="e.g. Billing service" {...register("description")} />
              </Field>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Events</p>
                {EVENTS.map((event) => (
                  <label key={event.value} className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm">
                    <Checkbox checked={events.includes(event.value)} onCheckedChange={() => toggleEvent(event.value)} />
                    <span>
                      <span className="font-mono text-xs">{event.label}</span>
                      <span className="block text-xs text-muted-foreground">{event.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={close} disabled={create.isPending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? <Loader className="animate-spin" /> : "Add endpoint"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────

const Page = () => {
  const { params, tableProps } = usePagination();
  const deliveryPage = usePagination();

  const webhooks = useWebhooks(params);
  const billing = useTenantBilling();
  const deliveries = useWebhookDeliveries(deliveryPage.params);
  const update = useUpdateWebhook();
  const remove = useDeleteWebhook();
  const rotate = useRotateWebhookSecret();
  const test = useTestWebhook();

  const [pendingDelete, setPendingDelete] = useState<WebhookEndpoint | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

  const subscription = billing.data?.subscription ?? null;

  /**
   * Mirrors the server (src/billing/feature-access.ts): **no subscription row at all
   * means unlimited**. Every org predating billing has none, and locking them out
   * here would hide a feature the API will happily serve them.
   *
   * While billing is loading, and if it fails to load, the page renders as entitled.
   * The server is the enforcement point and answers 403 either way, so guessing
   * "allowed" costs at most one toast — while guessing "denied" would flash an
   * upgrade notice at paying customers on every load, and turn a billing blip into an
   * apparent loss of a feature they pay for.
   */
  const entitled =
    billing.isPending ||
    billing.isError ||
    !subscription ||
    subscription.plan.entitlements.features.includes("webhooks");

  const columns = useMemo(
    () =>
      createWebhookColumns({
        entitled,
        onTest: (endpoint) =>
          test.mutate(endpoint.id, {
            onSuccess: () => toast.success("Test event queued — watch the deliveries below"),
            onError: (error) => toast.error(getErrorMessage(error)),
          }),
        onToggle: (endpoint) =>
          update.mutate(
            { id: endpoint.id, enabled: !endpoint.enabled },
            {
              onSuccess: () => toast.success(endpoint.enabled ? "Endpoint disabled" : "Endpoint enabled"),
              onError: (error) => toast.error(getErrorMessage(error)),
            },
          ),
        onRotate: (endpoint) =>
          rotate.mutate(endpoint.id, {
            // The previous secret stopped working the instant this returned, so the
            // new one has to be put in front of the user immediately.
            onSuccess: (updated) => setRotatedSecret(updated.secret),
            onError: (error) => toast.error(getErrorMessage(error)),
          }),
        onDelete: setPendingDelete,
      }),
    // The mutation objects are stable for the life of the page; rebuilding the
    // columns each render would reset the table's internal state. `entitled` is the
    // one input that legitimately changes — once, when billing resolves — and the
    // rebuild it causes lands while the table is still on its first page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entitled],
  );
  const deliveryColumns = useMemo(() => createDeliveryColumns(), []);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success("Endpoint deleted");
        setPendingDelete(null);
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  };

  if (webhooks.isError)
    return (
      <PageLayout title="Webhooks">
        <ErrorState
          title="Couldn't load webhooks"
          description={getErrorMessage(webhooks.error)}
          onRetry={() => webhooks.refetch()}
          retrying={webhooks.isFetching}
        />
      </PageLayout>
    );

  const endpoints = webhooks.data?.items ?? [];
  // `total` is the server's count for the whole org, not this page's slice — paging
  // to page 2 must not make the cap look further away than it is.
  const total = webhooks.data?.total ?? 0;
  const atCap = total >= ENDPOINT_LIMIT;

  return (
    <PageLayout
      title="Webhooks"
      subtitle="Receive signed events when documents are processed."
      actions={entitled ? <CreateWebhook disabled={atCap} describedBy={CAP_HINT_ID} /> : undefined}
    >
      <div className="space-y-6">
        {!entitled && <PlanNotice planName={subscription?.plan.name} />}
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-sm">Endpoints</p>
            {entitled && total > 0 && (
              <p id={CAP_HINT_ID} className={cn("text-xs", atCap ? "text-warning" : "text-muted-foreground")}>
                {/* At the cap the Add button is disabled, so the reason has to be on
                    screen — a control that just stops working reads as a bug. */}
                {total} of {ENDPOINT_LIMIT} endpoints used{atCap && " — delete one to add another"}
              </p>
            )}
          </div>
          {webhooks.isPending ? (
            <Skeleton skeleton="table" />
          ) : endpoints.length === 0 ? (
            <EmptyState
              icon={Webhook}
              title="No webhooks configured"
              description={
                entitled
                  ? "Add an endpoint to receive event notifications when documents are processed."
                  : "Your plan doesn't include webhooks, so there's nothing to configure here yet."
              }
            />
          ) : (
            <DataTable columns={columns} data={endpoints} total={webhooks.data?.total ?? 0} {...tableProps} />
          )}
        </section>

        {endpoints.length > 0 && (
          <section className="space-y-2">
            <p className="text-sm">Recent deliveries</p>
            {/* Said plainly: a delivery that is still "pending" is being retried, and
                one marked "dead" gave up — neither is obvious from the word alone. */}
            <p className="text-xs text-muted-foreground">
              Failed deliveries are retried with exponential backoff and marked dead after 6 attempts.
            </p>
            {deliveries.isPending ? (
              <Skeleton skeleton="table" />
            ) : (deliveries.data?.total ?? 0) === 0 ? (
              <EmptyState
                icon={Webhook}
                title="No deliveries yet"
                description="Send a test event from an endpoint's menu, or process a document."
              />
            ) : (
              <DataTable
                columns={deliveryColumns}
                data={deliveries.data?.items ?? []}
                total={deliveries.data?.total ?? 0}
                {...deliveryPage.tableProps}
              />
            )}
          </section>
        )}
      </div>

      <Dialog open={!!rotatedSecret} onOpenChange={(o) => !o && setRotatedSecret(null)}>
        <DialogContent title="New signing secret" description="The previous secret no longer works.">
          <div className="space-y-3">
            {rotatedSecret && (
              <SecretCallout
                value={rotatedSecret}
                title="Copy your new signing secret now"
                note="Shown once. Update your receiver before the next delivery."
              />
            )}
            <div className="flex justify-end">
              <Button onClick={() => setRotatedSecret(null)}>Done</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Delete webhook endpoint?"
        description={`${pendingDelete?.url ?? ""} will stop receiving events. Queued deliveries are marked dead.`}
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </PageLayout>
  );
};

export default Page;
