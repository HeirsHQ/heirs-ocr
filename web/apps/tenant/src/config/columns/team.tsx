import { Ban, CircleCheck, Trash2 } from "lucide-react";

import type { TenantRole, TenantUser } from "@/types/user";
import { createColumns, DateCell, SelectCell, TextCell } from "./core";

interface TeamColumnHandlers {
  roles: readonly TenantRole[];
  currentUserId?: string;
  /** Id of the row with an in-flight mutation, so its role select can disable. */
  busyId?: string | null;
  onRoleChange: (member: TenantUser, role: TenantRole) => void;
  onToggleDisabled: (member: TenantUser) => void;
  onDelete: (member: TenantUser) => void;
}

export function createTeamColumns({
  roles,
  currentUserId,
  busyId,
  onRoleChange,
  onToggleDisabled,
  onDelete,
}: TeamColumnHandlers) {
  return createColumns<TenantUser>({
    columns: [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => {
          const member = row.original;
          return (
            <div className="flex items-center gap-2">
              <span className="font-medium">{member.name}</span>
              {member.id === currentUserId && <span className="text-xs text-muted-foreground">(you)</span>}
              {member.disabled && <span className="text-xs text-muted-foreground">· disabled</span>}
            </div>
          );
        },
      },
      { accessorKey: "email", header: "Email", cell: ({ row }) => <TextCell value={row.original.email} /> },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => (
          <SelectCell
            value={row.original.role}
            options={roles}
            ariaLabel={`Role for ${row.original.email}`}
            disabled={busyId === row.original.id}
            onChange={(role) => onRoleChange(row.original, role)}
          />
        ),
      },
      { accessorKey: "createdAt", header: "Created", cell: ({ row }) => <DateCell date={row.original.createdAt} /> },
    ],
    actions: (member) => [
      {
        label: member.disabled ? "Enable" : "Disable",
        icon: member.disabled ? CircleCheck : Ban,
        variant: member.disabled ? "success" : "warning",
        onClick: () => onToggleDisabled(member),
      },
      {
        label: "Delete",
        icon: Trash2,
        variant: "destructive",
        hidden: member.id === currentUserId,
        onClick: () => onDelete(member),
      },
    ],
  });
}
