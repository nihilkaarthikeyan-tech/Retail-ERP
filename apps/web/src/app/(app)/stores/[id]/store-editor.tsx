// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { use, useState } from "react";
import { hasPermission } from "shared";
import { StoreForm } from "@/components/store-form";
import { ActiveBadge, Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { GstRegistrationDto, StoreDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

export function StoreEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canManage = hasPermission(user, "stores.manage");
  const canSeeCompany = hasPermission(user, "company.view");
  const store = useLoad(() => api.get<StoreDto>(`/stores/${id}`), [id]);
  const regs = useLoad<GstRegistrationDto[]>(
    () => (canSeeCompany ? api.get<GstRegistrationDto[]>("/company/gst-registrations") : Promise.resolve([])),
    [canSeeCompany],
  );
  const [saved, setSaved] = useState(false);

  if (store.error) {
    return (
      <>
        <h1>Store</h1>
        <Alert kind="error">{store.error}</Alert>
        <Link href="/stores">Back to stores</Link>
      </>
    );
  }
  if (!store.data || regs.loading) return <p className="muted">Loading…</p>;

  return (
    <>
      <p>
        <Link href="/stores">← Stores</Link>
      </p>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          {store.data.code} — {store.data.name}
        </h1>
        <ActiveBadge active={store.data.active} />
      </div>
      {saved ? <Alert kind="success">Store saved.</Alert> : null}
      <div className="card">
        <StoreForm
          key={store.data.id + String(store.data.active)}
          store={store.data}
          registrations={regs.data ?? []}
          readOnly={!canManage}
          onSaved={(s) => {
            store.setData(s);
            setSaved(true);
          }}
        />
      </div>
    </>
  );
}
