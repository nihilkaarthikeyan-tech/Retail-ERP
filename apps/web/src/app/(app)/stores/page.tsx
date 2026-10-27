// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { hasPermission } from "shared";
import { StoreForm } from "@/components/store-form";
import { ActiveBadge, Alert, Button, DataTable, Dialog, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { GstRegistrationDto, StoreDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

export default function StoresPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "stores.manage");
  const canSeeCompany = hasPermission(user, "company.view");
  const stores = useLoad(() => api.get<StoreDto[]>("/stores"));
  const regs = useLoad<GstRegistrationDto[]>(
    () => (canSeeCompany ? api.get<GstRegistrationDto[]>("/company/gst-registrations") : Promise.resolve([])),
    [canSeeCompany],
  );
  const [adding, setAdding] = useState(false);
  const defaultGstin = regs.data?.find((r) => r.isDefault && r.active)?.gstin;

  const columns: Column<StoreDto>[] = [
    { key: "code", header: "Code", render: (s) => <Link href={`/stores/${s.id}`}>{s.code}</Link> },
    { key: "name", header: "Name", render: (s) => s.name },
    { key: "city", header: "City", render: (s) => s.city ?? "—" },
    { key: "gstin", header: "GSTIN", render: (s) =>
        s.gstRegistration ? (
          <span className="mono">{s.gstRegistration.gstin}</span>
        ) : defaultGstin ? (
          <span>
            <span className="mono">{defaultGstin}</span> <span className="muted">(company default)</span>
          </span>
        ) : (
          "—"
        ),
    },
    { key: "active", header: "Status", render: (s) => <ActiveBadge active={s.active} /> },
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Stores</h1>
        <span className="spacer" />
        {canManage ? (
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add store
          </Button>
        ) : null}
      </div>
      <Alert kind="error">{stores.error}</Alert>
      <DataTable columns={columns} rows={stores.data} rowKey={(s) => s.id} loading={stores.loading} empty="No stores yet." />

      <Dialog open={adding} title="Add store" onClose={() => setAdding(false)}>
        <StoreForm
          store={null}
          registrations={regs.data ?? []}
          onSaved={async () => {
            setAdding(false);
            await stores.reload();
          }}
          onCancel={() => setAdding(false)}
        />
      </Dialog>
    </>
  );
}
