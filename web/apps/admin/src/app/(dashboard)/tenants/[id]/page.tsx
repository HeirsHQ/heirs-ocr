"use client";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, PencilLine, Users } from "lucide-react";
import { useMemo } from "react";
import Link from "next/link";

import { createTenantUserColumns } from "@/config/columns/tenant-users";
import { useTenant } from "@/hooks/api/use-admin-tenants";
import { getErrorMessage } from "@heirs/api-client";
import type { StatusTone } from "@heirs/ui";
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  PageLayout,
  Skeleton,
  StatusBadge,
  TextLabel,
  capitalize,
  usePagination,
} from "@heirs/ui";

const SUB_TONE: Record<string, StatusTone> = {
  active: "healthy",
  trialing: "pending",
  past_due: "attention",
  canceled: "inactive",
  expired: "inactive",
  suspended: "failed",
};

const Page = () => {
  const id = useParams().id as string;
  const router = useRouter();
  const { data, isPending, isError, error, refetch, isFetching } = useTenant(id);

  const columns = useMemo(() => createTenantUserColumns(), []);
  /**
   * Paged in the browser: the list arrives whole, but DataTable renders a pagination
   * bar once `total` exceeds the page size — without handlers that bar was inert.
   * Declared above the early returns below so hook order stays stable.
   */
  const userPage = usePagination();

  if (isPending) {
    return (
      <PageLayout title="" subtitle="">
        <Skeleton skeleton="profile" />
      </PageLayout>
    );
  }

  if (isError) {
    return (
      <PageLayout title="" subtitle="">
        <ErrorState
          title="Couldn't load tenant"
          description={getErrorMessage(error)}
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      </PageLayout>
    );
  }

  const { tenant, keys, users, subscription, plan } = data;

  return (
    <PageLayout
      title={capitalize(tenant.name ?? tenant.tenantId)}
      subtitle={tenant.tenantId}
      actions={[
        <Button key="edit" render={<Link href={`/tenants/${id}/edit`} />}>
          <PencilLine className="size-4" />
          Edit tenant
        </Button>,
      ]}
    >
      <div className="space-y-8">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => router.push("/tenants")}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Registry</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TextLabel label="Tenant ID" value={<span className="font-mono text-sm">{tenant.tenantId}</span>} />
            <TextLabel label="Rate limit" value={tenant.rateLimit ? `${tenant.rateLimit}/min` : "Default"} />
            <TextLabel
              label="Functions"
              value={!tenant.allowedFunctions?.length ? "All" : `${tenant.allowedFunctions.length} allowed`}
            />
            <TextLabel
              label="Status"
              value={
                tenant.disabled ? (
                  <StatusBadge tone="inactive" label="Disabled" />
                ) : (
                  <StatusBadge tone="healthy" label="Active" />
                )
              }
            />
          </div>
          {!!keys.length && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">API Key Hashes</p>
              <ul className="space-y-1">
                {keys.map((hash) => (
                  <li key={hash} className="font-mono text-xs text-muted-foreground">
                    {hash}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Subscription</h2>
          {subscription && plan ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <TextLabel label="Plan" value={plan.name} />
              <TextLabel label="Tier" value={<span className="capitalize">{plan.tier}</span>} />
              <TextLabel
                label="Status"
                value={
                  <StatusBadge
                    tone={SUB_TONE[subscription.status] ?? "inactive"}
                    label={subscription.status.replace("_", " ")}
                  />
                }
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No subscription — tenant runs on unlimited defaults.</p>
          )}
        </section>
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Portal users</h2>
          {users.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No portal users"
              description="Seed an owner login from the tenants list to grant portal access."
            />
          ) : (
            <DataTable
              columns={columns}
              data={users.slice(
                (userPage.params.page - 1) * userPage.params.pageSize,
                userPage.params.page * userPage.params.pageSize,
              )}
              total={users.length}
              {...userPage.tableProps}
            />
          )}
        </section>
      </div>
    </PageLayout>
  );
};

export default Page;
