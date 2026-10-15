// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { hasPermission } from "shared";
import { AuditTable } from "@/components/audit-table";
import { BillEditor } from "@/components/purchasing/bills-editor";
import { BillView } from "@/components/purchasing/bills-view";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { purchaseRights, type SupplierBillDto } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";

type Tab = "details" | "history";

export function SupplierBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const canSeeHistory = hasPermission(user, "audit.view");
  const bill = useLoad(() => api.get<SupplierBillDto>(`/purchase/bills/${id}`), [id]);
  const [tab, setTab] = useState<Tab>("details");
  const [editing, setEditing] = useState(false);

  if (bill.error) {
    return (
      <>
        <h1>Supplier bill</h1>
        <Alert kind="error">{bill.error}</Alert>
        <Link href="/purchases/bills">Back to supplier bills</Link>
      </>
    );
  }
  if (!bill.data) return <p className="muted">Loading…</p>;
  const b = bill.data;
  const canEdit = b.status === "draft" && b.kind !== "debit_note" && purchaseRights(user).bill;

  return (
    <>
      <p>
        <Link href="/purchases/bills">← Supplier bills</Link>
      </p>
      {canSeeHistory ? (
        <div className="tabs" role="tablist" aria-label="Bill sections">
          {(["details", "history"] as const).map((t) => (
            <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} className="tab" onClick={() => setTab(t)}>
              {t === "details" ? "Details" : "History"}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={canSeeHistory ? `tab-${tab}` : undefined}>
        {tab === "details" ? (
          editing && canEdit && b.kind !== "debit_note" ? (
            <BillEditor
              kind={b.kind}
              bill={b}
              onSaved={(saved) => {
                bill.setData(saved);
                setEditing(false);
              }}
              onClose={() => setEditing(false)}
            />
          ) : (
            <BillView bill={b} onChanged={bill.setData} onEdit={canEdit ? () => setEditing(true) : undefined} onDebitNote={(note) => router.push(`/purchases/bills/${note.id}`)} />
          )
        ) : (
          <AuditTable path="/audit" withEntity={false} record={{ entityType: "supplier_bill", entityId: b.id }} />
        )}
      </div>
    </>
  );
}
