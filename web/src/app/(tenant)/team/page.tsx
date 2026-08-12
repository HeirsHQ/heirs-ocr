"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Loader, UserPlus, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog, DataTable, PageLayout } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  useCreateTeamMember,
  useDeleteTeamMember,
  useTenantTeam,
  useUpdateTeamMember,
} from "@/hooks/api/use-tenant-team";
import { useTenantMe } from "@/hooks/api/use-tenant-auth";
import { getErrorMessage } from "@/lib/client";
import { cn } from "@/lib/utils";
import { createTeamColumns } from "@/config/columns/team";
import type { TenantRole, TenantUser } from "@/types/user";

const ROLES: TenantRole[] = ["owner", "member"];

const schema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  role: z.enum(["owner", "member"]),
  password: z.string().min(8, "At least 8 characters"),
});
type FormValues = z.infer<typeof schema>;

const selectClass = cn(
  "h-8 rounded-md border border-input bg-transparent px-2.5 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
);

const InviteMemberModal = () => {
  const [open, setOpen] = useState(false);
  const createMember = useCreateTeamMember();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { role: "member" } });

  const onSubmit = handleSubmit((values) => {
    createMember.mutate(values, {
      onSuccess: () => {
        toast.success(`${values.email} added to the team`);
        reset({ name: "", email: "", role: "member", password: "" });
        setOpen(false);
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        Add member
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Add a team member">
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
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={createMember.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMember.isPending}>
                {createMember.isPending ? <Loader className="animate-spin" /> : "Add member"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

const Page = () => {
  const team = useTenantTeam();
  const me = useTenantMe();
  const updateMember = useUpdateTeamMember();
  const deleteMember = useDeleteTeamMember();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TenantUser | null>(null);

  const patch = (member: TenantUser, patch: Parameters<typeof updateMember.mutate>[0]["patch"], ok: string) => {
    setBusyId(member.id);
    updateMember.mutate(
      { id: member.id, patch },
      {
        onSuccess: () => toast.success(ok),
        onError: (error) => toast.error(getErrorMessage(error)),
        onSettled: () => setBusyId(null),
      },
    );
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const member = pendingDelete;
    deleteMember.mutate(member.id, {
      onSuccess: () => {
        toast.success(`${member.email} removed`);
        setPendingDelete(null);
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  };

  const columns = useMemo(
    () =>
      createTeamColumns({
        roles: ROLES,
        currentUserId: me.data?.user.id,
        busyId,
        onRoleChange: (member, role) => patch(member, { role }, "Role updated"),
        onToggleDisabled: (member) =>
          patch(member, { disabled: !member.disabled }, member.disabled ? "Member enabled" : "Member disabled"),
        onDelete: (member) => setPendingDelete(member),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me.data?.user.id, busyId],
  );

  return (
    <PageLayout title="Team" subtitle="Manage who can sign in to your organization's portal.">
      <div className="space-y-6">
        <InviteMemberModal />

        {team.isPending && <p className="text-sm text-muted-foreground">Loading team…</p>}

        {team.isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {getErrorMessage(team.error)}
          </div>
        )}

        {team.data && team.data.users.length === 0 && (
          <div className="flex flex-col items-center gap-1 rounded-md border border-dashed py-10 text-center">
            <UsersRound className="size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No team members yet.</p>
          </div>
        )}

        {team.data && team.data.users.length > 0 && (
          <div className="rounded-md border">
            <DataTable columns={columns} data={team.data.users} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Remove member"
        description={pendingDelete ? `${pendingDelete.email} will lose access to the portal.` : undefined}
        confirmLabel="Remove"
        pending={deleteMember.isPending}
        onConfirm={confirmDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      />
    </PageLayout>
  );
};

export default Page;
