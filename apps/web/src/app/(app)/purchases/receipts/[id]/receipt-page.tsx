// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { use, useState } from "react";
import { hasPermission } from "shared";
import { AuditTable } from "@/components/audit-table";
import { ReceiptEditor } from "@/components/purchasing/receipts-editor";
import { ReceiptView } from "@/components/purchasing/receipts-view";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { type GoodsReceiptDto, purchaseRights } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";

type Tab = "details" | "history";

export function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const canSeeHistory = hasPermission(user, "audit.view");
  const receipt = useLoad(() => api.get<GoodsReceiptDto>(`/purchase/receipts/${id}`), [id]);
  const locations = useStockLocations();
  const [tab, setTab] = useState<Tab>("details");

  if (receipt.error) {
    return (
      <>
        <h1>Goods receipt</h1>
        <Alert kind="error">{receipt.error}</Alert>
        <Link href="/purchases/receipts">Back to goods receipts</Link>
      </>
    );
  }
  if (!receipt.data || !locations.data) {
    return (
      <>
        <Alert kind="error">{locations.error}</Alert>
        <p className="muted">Loading…</p>
      </>
    );
  }
  const r = receipt.data;
  const useEditor = r.status === "draft" && !r.isReturn && !r.billId && rights.receive;

  return (
    <>
      <p>
        <Link href="/purchases/receipts">← Goods receipts</Link>
      </p>
      {canSeeHistory ? (
        <div className="tabs" role="tablist" aria-label="Receipt sections">
          {(["details", "history"] as const).map((t) => (
            <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} className="tab" onClick={() => setTab(t)}>
              {t === "details" ? "Details" : "History"}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={canSeeHistory ? `tab-${tab}` : undefined}>
        {tab === "details" ? (
          useEditor ? (
            <ReceiptEditor receipt={r} locations={locations.data} onSaved={receipt.setData} />
          ) : (
            <ReceiptView key={r.id} receipt={r} locations={locations.data} onChanged={receipt.setData} />
          )
        ) : (
          <AuditTable path="/audit" withEntity={false} record={{ entityType: "goods_receipt", entityId: r.id }} />
        )}
      </div>
    </>
  );
}
