// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { posRights, type TillDto, useTills } from "@/components/pos/pos-shared";
import { ActiveBadge, Alert, DataTable, type Column } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { showQuantity } from "@/lib/stock";

export default function TillsPage() {
  const { user } = useAuth();
  const rights = posRights(user);
  const tills = useTills();

  const columns: Column<TillDto>[] = [
    {
      key: "code",
      header: "Till",
      render: (t) => (
        <Link href={`/pos/tills/${t.id}`} className="mono">
          {t.code}
        </Link>
      ),
    },
    { key: "name", header: "Name", render: (t) => t.name },
    { key: "store", header: "Store", render: (t) => `${t.store.code} — ${t.store.name}` },
    { key: "discount", header: "Cashier discount", align: "right", render: (t) => `${showQuantity(t.cashierDiscountPercent)}%` },
    { key: "computer", header: "Computer", render: (t) => (t.devices.length ? t.devices.map((d) => d.deviceName).join(", ") : <span className="muted">Not registered</span>) },
    { key: "active", header: "Status", render: (t) => <ActiveBadge active={t.active} /> },
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Tills</h1>
        <span className="spacer" />
        {rights.setup ? (
          <Link href="/pos/tills/new" className="btn btn-primary">
            Add till
          </Link>
        ) : null}
      </div>
      <p className="muted">Each billing counter is a till: it belongs to one store, sells from one location and has its own bill numbers.</p>
      <Alert kind="error">{tills.error}</Alert>
      <DataTable columns={columns} rows={tills.data} rowKey={(t) => t.id} loading={tills.loading} empty="No tills yet." />
    </>
  );
}
