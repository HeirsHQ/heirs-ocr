import { Ban, CircleCheck, Trash2 } from "lucide-react";

import type { AdminRole, AdminUser } from "@/types/user";
import { createColumns, DateCell, SelectCell, TextCell } from "./core";

interface UserColumnHandlers {
  roles: readonly AdminRole[];
  currentUserId?: string;
  /** Id of the row with an in-flight mutation, so its role select can disable. */
  busyId?: string | null;
  onRoleChange: (user: AdminUser, role: AdminRole) => void;
  onToggleDisabled: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
}

export function createUserColumns({
  roles,
  currentUserId,
  busyId,
  onRoleChange,
  onToggleDisabled,
  onDelete,
}: UserColumnHandlers) {
  return createColumns<AdminUser>({
    columns: [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => {
          const user = row.original;
          return (
            <div className="flex items-center gap-2">
              <span className="font-medium">{user.name}</span>
              {user.id === currentUserId && <span className="text-xs text-muted-foreground">(you)</span>}
              {user.disabled && <span className="text-xs text-muted-foreground">· disabled</span>}
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
    actions: (user) => [
      {
        label: user.disabled ? "Enable" : "Disable",
        icon: user.disabled ? CircleCheck : Ban,
        variant: user.disabled ? "success" : "warning",
        onClick: () => onToggleDisabled(user),
      },
      {
        label: "Delete",
        icon: Trash2,
        variant: "destructive",
        hidden: user.id === currentUserId,
        onClick: () => onDelete(user),
      },
    ],
  });
}
