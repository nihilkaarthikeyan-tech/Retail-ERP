// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserForm } from "@/components/user-form";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { RoleDto, StoreDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

export default function NewUserPage() {
  const { user: me } = useAuth();
  const router = useRouter();
  const roles = useLoad(() => api.get<RoleDto[]>("/roles"));
  const stores = useLoad(() => api.get<StoreDto[]>("/stores"));

  return (
    <>
      <p>
        <Link href="/users">← Users</Link>
      </p>
      <h1>Add user</h1>
      <Alert kind="error">{roles.error ?? stores.error}</Alert>
      {roles.data && stores.data ? (
        <UserForm user={null} roles={roles.data} stores={stores.data} selfId={me?.id} onSaved={(u) => router.replace(`/users/${u.id}`)} />
      ) : (
        <p className="muted">Loading…</p>
      )}
    </>
  );
}
