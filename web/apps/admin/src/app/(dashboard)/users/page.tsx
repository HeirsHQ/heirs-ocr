"use client";

import { Loader, UserPlus, Users } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog, DataTable, EmptyState, ErrorState, PageLayout, Skeleton } from "@/components/shared";
import { useAdminUsers, useCreateAdmin, useDeleteAdmin, useUpdateAdmin } from "@/hooks/api/use-admin-users";
import { createUserColumns } from "@/config/columns/users";
import type { AdminRole, AdminUser } from "@/types/user";
import { SelectOption, type Option } from "@heirs/ui";
import { getErrorMessage } from "@heirs/api-client";
import { Dialog, DialogContent } from "@heirs/ui";
import { useMe } from "@/hooks/api/use-auth";
import { Button } from "@heirs/ui";
import { Input } from "@heirs/ui";
import { usePagination } from "@heirs/ui";

const ROLES: AdminRole[] = ["owner", "manager", "viewer"];

/** Console roles, least → most privileged, with what each one can actually do. */
const ROLE_OPTIONS: Option[] = [
  { label: "Viewer — read-only", value: "viewer" },
  { label: "Manager — manage tenants & plans", value: "manager" },
  { label: "Owner — full access", value: "owner" },
];

const schema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  role: z.enum(["owner", "manager", "viewer"]),
  password: z.string().min(8, "At least 8 characters"),
});
type FormValues = z.infer<typeof schema>;

const InviteUserModal = () => {
  const [open, setOpen] = useState(false);
  const createAdmin = useCreateAdmin();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { role: "viewer" } });

  const onSubmit = handleSubmit((values) => {
    createAdmin.mutate(values, {
      onSuccess: () => {
        toast.success(`${values.email} added`);
        reset({ name: "", email: "", role: "viewer", password: "" });
        setOpen(false);
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        Add user
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Add a console user">
          <form onSubmit={onSubmit} className="space-y-3" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Input placeholder="Full name" aria-invalid={!!errors.name} {...register("name")} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-1">
                <Input type="email" placeholder="Email" aria-invalid={!!errors.email} {...register("email")} />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-1">
                <Controller
                  control={control}
                  name="role"
                  render={({ field }) => (
                    <SelectOption
                      options={ROLE_OPTIONS}
                      value={field.value}
                      onValueChange={field.onChange}
                      aria-label="Role"
                    />
                  )}
                />
              </div>
              <div className="space-y-1">
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Temporary password"
                  aria-invalid={!!errors.password}
                  {...register("password")}
                />
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={createAdmin.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={createAdmin.isPending}>
                {createAdmin.isPending ? <Loader className="animate-spin" /> : "Add user"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

const Page = () => {
  const { params, tableProps } = usePagination();
  const users = useAdminUsers(params);
  const me = useMe();
  const updateAdmin = useUpdateAdmin();
  const deleteAdmin = useDeleteAdmin();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);

  const patch = (user: AdminUser, patch: Parameters<typeof updateAdmin.mutate>[0]["patch"], ok: string) => {
    setBusyId(user.id);
    updateAdmin.mutate(
      { id: user.id, patch },
      {
        onSuccess: () => toast.success(ok),
        onError: (error) => toast.error(getErrorMessage(error)),
        onSettled: () => setBusyId(null),
      },
    );
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const user = pendingDelete;
    deleteAdmin.mutate(user.id, {
      onSuccess: () => {
        toast.success(`${user.email} removed`);
        setPendingDelete(null);
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  };

  const columns = useMemo(
    () =>
      createUserColumns({
        roles: ROLES,
        currentUserId: me.data?.user.id,
        busyId,
        onRoleChange: (user, role) => patch(user, { role }, "Role updated"),
        onToggleDisabled: (user) =>
          patch(user, { disabled: !user.disabled }, user.disabled ? "User enabled" : "User disabled"),
        onDelete: (user) => setPendingDelete(user),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me.data?.user.id, busyId],
  );

  return (
    <PageLayout
      title="Users"
      subtitle="Manage who can sign in to the admin console and what they can do."
      actions={[<InviteUserModal key="new" />]}
    >
      <div className="space-y-6">
        {users.isPending && <Skeleton skeleton="table" columns={4} rows={5} />}
        {users.isError && (
          <ErrorState
            title="Couldn't load console users"
            description={getErrorMessage(users.error)}
            onRetry={() => users.refetch()}
            retrying={users.isFetching}
          />
        )}
        {users.data && users.data.items.length === 0 && (
          <EmptyState icon={Users} title="No console users" description="Add a user above to grant console access." />
        )}

        {users.data && users.data.items.length > 0 && (
          <DataTable columns={columns} data={users.data.items} total={users.data.total} {...tableProps} />
        )}
      </div>
      <ConfirmDialog
        open={!!pendingDelete}
        title="Remove user"
        description={pendingDelete ? `${pendingDelete.email} will lose access to the console.` : undefined}
        confirmLabel="Remove"
        pending={deleteAdmin.isPending}
        onConfirm={confirmDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      />
    </PageLayout>
  );
};

export default Page;
