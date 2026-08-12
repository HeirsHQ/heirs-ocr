"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Loader, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog, DataTable, PageLayout } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAdminUsers, useCreateAdmin, useDeleteAdmin, useUpdateAdmin } from "@/hooks/api/use-admin-users";
import { useMe } from "@/hooks/api/use-auth";
import { getErrorMessage } from "@/lib/client";
import { cn } from "@/lib/utils";
import { createUserColumns } from "@/config/columns/users";
import type { AdminRole, AdminUser } from "@/types/user";

const ROLES: AdminRole[] = ["owner", "manager", "viewer"];

const schema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  role: z.enum(["owner", "manager", "viewer"]),
  password: z.string().min(8, "At least 8 characters"),
});
type FormValues = z.infer<typeof schema>;

const selectClass = cn(
  "h-8 rounded-md border border-input bg-transparent px-2.5 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
);

const InviteUserModal = () => {
  const [open, setOpen] = useState(false);
  const createAdmin = useCreateAdmin();
  const {
    register,
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
                <select className={cn(selectClass, "w-full")} aria-label="Role" {...register("role")}>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
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
  const users = useAdminUsers();
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
        {users.isPending && <p className="text-sm text-muted-foreground">Loading users…</p>}
        {users.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {getErrorMessage(users.error)}
          </div>
        )}
        {users.data && users.data.admins.length === 0 && (
          <div className="flex flex-col items-center gap-1 rounded-md border border-dashed py-10 text-center">
            <Users className="size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No console users yet.</p>
          </div>
        )}

        {users.data && users.data.admins.length > 0 && (
          <div className="rounded-md border">
            <DataTable columns={columns} data={users.data.admins} />
          </div>
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
