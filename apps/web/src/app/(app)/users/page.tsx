// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { hasPermission } from "shared";
import { ActiveBadge, Alert, Badge, DataTable, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, fullName } from "@/lib/format";
import type { UserDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

export default function UsersPage() {
  const { user: me } = useAuth();
  const canManage = hasPermission(me, "users.manage");
  const users = useLoad(() => api.get<UserDto[]>("/users"));

  const columns: Column<UserDto>[] = [
    {
      key: "name",
      header: "Name",
      render: (u) => (canManage ? <Link href={`/users/${u.id}`}>{fullName(u)}</Link> : fullName(u)),
    },
    { key: "email", header: "Email", render: (u) => u.email },
    { key: "roles", header: "Roles", render: (u) => u.roles.map((r) => r.name).join(", ") || <span className="muted">none</span> },
    {
      key: "stores",
      header: "Stores",
      render: (u) => (u.allStores ? "All stores" : u.stores.map((s) => s.code).join(", ") || <span className="muted">none</span>),
    },
    {
      key: "status",
      header: "Status",
      render: (u) => (
        <span className="row-actions">
          <ActiveBadge active={u.active} />
          {u.mustChangePassword ? <Badge kind="warn">Password change pending</Badge> : null}
          {u.lockedUntil && new Date(u.lockedUntil) > new Date() ? <Badge kind="warn">Locked</Badge> : null}
        </span>
      ),
    },
    { key: "login", header: "Last login", render: (u) => formatDateTime(u.lastLoginAt) },
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Users</h1>
        <span className="spacer" />
        {canManage ? (
          <Link href="/users/new" className="btn btn-primary">
            Add user
          </Link>
        ) : null}
      </div>
      <Alert kind="error">{users.error}</Alert>
      <DataTable columns={columns} rows={users.data} rowKey={(u) => u.id} loading={users.loading} empty="No users." />
    </>
  );
}
