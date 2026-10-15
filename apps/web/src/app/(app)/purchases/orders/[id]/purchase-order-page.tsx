// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { use, useState } from "react";
import { hasPermission } from "shared";
import { AuditTable } from "@/components/audit-table";
import { OrdersEditor } from "@/components/purchasing/orders-editor";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { PurchaseOrderDto } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";

type Tab = "details" | "history";

export function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canSeeHistory = hasPermission(user, "audit.view");
  const order = useLoad(() => api.get<PurchaseOrderDto>(`/purchase/orders/${id}`), [id]);
  const [tab, setTab] = useState<Tab>("details");

  if (order.error && !order.data) {
    return (
      <>
        <h1>Purchase order</h1>
        <Alert kind="error">{order.error}</Alert>
        <Link href="/purchases/orders">Back to purchase orders</Link>
      </>
    );
  }
  if (!order.data) return <p className="muted">Loading…</p>;

  return (
    <>
      <p>
        <Link href="/purchases/orders">← Purchase orders</Link>
      </p>
      {canSeeHistory ? (
        <div className="tabs" role="tablist" aria-label="Order sections">
          {(["details", "history"] as const).map((t) => (
            <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} className="tab" onClick={() => setTab(t)}>
              {t === "details" ? "Details" : "History"}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={canSeeHistory ? `tab-${tab}` : undefined}>
        {tab === "details" ? (
          <OrdersEditor order={order.data} onSaved={order.setData} />
        ) : (
          <AuditTable path="/audit" withEntity={false} record={{ entityType: "purchase_order", entityId: order.data.id }} />
        )}
      </div>
    </>
  );
}
