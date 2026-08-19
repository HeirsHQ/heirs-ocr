"use client";

import { Building2, Loader, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";

import { createTenantColumns } from "@/config/columns/tenants";
import { Button, Input, SelectOption } from "@heirs/ui";
import { usePlans } from "@/hooks/api/use-admin-plans";
import { getErrorMessage, MAX_PAGE_SIZE } from "@heirs/api-client";
import { Dialog, DialogContent } from "@heirs/ui";
import { usePagination } from "@heirs/ui";
import type { AdminTenant } from "@/types/tenant";
import { ConfirmDialog, DataTable, EmptyState, ErrorState, PageLayout, Skeleton } from "@/components/shared";
import {
  useAssignSubscription,
  useDeleteTenant,
  useSeedTenantOwner,
  useTenantLoginUsers,
  useTenantSubscription,
  useTenants,
} from "@/hooks/api/use-admin-tenants";

type ModalKind = "edit" | "owners" | "plan";

const OwnersModal = ({ tenantId, onClose }: { tenantId: string; onClose: () => void }) => {
  const users = useTenantLoginUsers(tenantId);
  const seed = useSeedTenantOwner(tenantId);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const add = () => {
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || password.length < 8) {
      toast.error("Enter a name, a valid email, and an 8+ character password.");
      return;
    }
    seed.mutate(
      { name: name.trim(), email: email.trim(), password },
      {
        onSuccess: () => {
          toast.success(`Owner login created for ${email.trim()}`);
          setName("");
          setEmail("");
          setPassword("");
        },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Portal access — ${tenantId}`} description="Owner logins that can sign in at /login.">
        <div className="space-y-5">
          {users.isPending && <p className="text-xs text-muted-foreground">Loading logins…</p>}
          {users.isError && <p className="text-xs text-destructive">{getErrorMessage(users.error)}</p>}
          {users.data && users.data.items.length > 0 ? (
            <ul className="divide-y rounded-md border text-sm">
              {users.data.items.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                  <span className="truncate">
                    {u.name} <span className="text-muted-foreground">· {u.email}</span>
                  </span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {u.role}
                    {u.disabled && " · disabled"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            users.data && (
              <p className="rounded-md border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
                No portal login yet — add an owner below.
              </p>
            )
          )}
          <div className="grid gap-2 grid-cols-2 mt-10">
            <div className="col-span-2">
              <Input placeholder="Owner name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Input type="email" placeholder="Owner email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="Temp password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button onClick={add} disabled={seed.isPending}>
              {seed.isPending ? <Loader className="animate-spin" /> : "Add owner"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Subscription modal ──────────────────────────────────────────────────────────

const PlanModal = ({ tenantId, onClose }: { tenantId: string; onClose: () => void }) => {
  const sub = useTenantSubscription(tenantId);
  // Feeds a plan picker, so it needs the whole catalog rather than a first page.
  const plans = usePlans({ pageSize: MAX_PAGE_SIZE });
  const assign = useAssignSubscription(tenantId);
  const [planId, setPlanId] = useState("");

  const current = sub.data?.subscription;
  const available = plans.data?.items ?? [];

  const onAssign = () => {
    if (!planId) return;
    assign.mutate(planId, {
      onSuccess: (res) => {
        toast.success(`Assigned “${res.subscription.plan.name}”`);
        onClose();
      },
      onError: (e) => toast.error(getErrorMessage(e)),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Subscription — ${tenantId}`}>
        <div className="space-y-3">
          {sub.isPending ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : current ? (
            <p className="text-sm">
              Current: <span className="font-medium">{current.plan.name}</span>{" "}
              <span className="text-muted-foreground">· {current.plan.tier}</span>
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {current.status}
              </span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No subscription — tenant runs on unlimited defaults.</p>
          )}

          {plans.isError ? (
            <p className="text-xs text-destructive">{getErrorMessage(plans.error)}</p>
          ) : available.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No plans in the catalog yet — create one under Subscription Plans.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <SelectOption
                  aria-label="Plan"
                  placeholder="Select a plan…"
                  value={planId || undefined}
                  onValueChange={setPlanId}
                  options={available.map((p) => ({
                    label: p.hidden ? `${p.name} (${p.tier}) · admin-only` : `${p.name} (${p.tier})`,
                    value: p.id,
                  }))}
                />
                <Button onClick={onAssign} disabled={!planId || assign.isPending}>
                  {assign.isPending ? <Loader className="size-4 animate-spin" /> : current ? "Change" : "Assign"}
                </Button>
              </div>
              {planId && available.find((p) => p.id === planId)?.hidden && (
                <p className="text-xs text-muted-foreground">
                  Enterprise plan — custom pricing, not visible to tenants in self-serve.
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────

const Page = () => {
  const router = useRouter();
  const { params, tableProps } = usePagination();
  const tenants = useTenants(params);
  const deleteTenant = useDeleteTenant();
  const [active, setActive] = useState<{ kind: ModalKind; row: AdminTenant } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminTenant | null>(null);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const { keyHash, tenant } = pendingDelete;
    deleteTenant.mutate(keyHash, {
      onSuccess: () => {
        toast.success(`Tenant “${tenant.tenantId}” revoked`);
        setPendingDelete(null);
      },
      onError: (e) => toast.error(getErrorMessage(e)),
    });
  };

  const columns = useMemo(
    () =>
      createTenantColumns({
        onOwners: (row) => setActive({ kind: "owners", row }),
        onPlan: (row) => setActive({ kind: "plan", row }),
        onDelete: (row) => setPendingDelete(row),
        onOpen: (row) => router.push(`/tenants/${row.tenant.tenantId}`),
      }),
    // `router` is stable across renders, so this never actually rebuilds the columns
    // — listing it keeps the dependency honest rather than silencing the rule.
    [router],
  );

  return (
    <PageLayout
      title="Tenants"
      subtitle="Provision organizations and manage their access."
      actions={[
        <Button key="new" render={<Link href="/tenants/new" />}>
          <Plus className="size-4" />
          New tenant
        </Button>,
      ]}
    >
      <div className=" space-y-6">
        {tenants.isPending && <Skeleton skeleton="table" columns={5} rows={6} />}
        {tenants.isError && (
          <ErrorState
            title="Couldn't load tenants"
            description={getErrorMessage(tenants.error)}
            onRetry={() => tenants.refetch()}
            retrying={tenants.isFetching}
          />
        )}
        {tenants.data && tenants.data.items.length === 0 && (
          <EmptyState
            icon={Building2}
            title="No tenants yet"
            description="Create a tenant above to issue an API key and assign a plan."
          />
        )}
        {tenants.data && tenants.data.items.length > 0 && (
          <DataTable columns={columns} data={tenants.data.items} total={tenants.data.total} {...tableProps} />
        )}
      </div>
      {active?.kind === "owners" && (
        <OwnersModal tenantId={active.row.tenant.tenantId} onClose={() => setActive(null)} />
      )}
      {active?.kind === "plan" && <PlanModal tenantId={active.row.tenant.tenantId} onClose={() => setActive(null)} />}
      <ConfirmDialog
        open={!!pendingDelete}
        title="Revoke tenant"
        description={pendingDelete ? `“${pendingDelete.tenant.tenantId}” will lose API access immediately.` : undefined}
        confirmLabel="Revoke"
        pending={deleteTenant.isPending}
        onConfirm={confirmDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      />
    </PageLayout>
  );
};

export default Page;
