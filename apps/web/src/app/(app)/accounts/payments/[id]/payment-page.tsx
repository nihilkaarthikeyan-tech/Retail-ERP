// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { use, useState } from "react";
import { hasPermission } from "shared";
import { PaymentForm } from "@/components/accounts/payment-form";
import { PaymentView } from "@/components/accounts/payment-view";
import { AuditTable } from "@/components/audit-table";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { accountRights, type PaymentDto } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { useLoad } from "@/lib/use-load";

type Tab = "details" | "history";

export function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const rights = accountRights(user);
  const canSeeHistory = hasPermission(user, "audit.view");
  const payment = useLoad(() => api.get<PaymentDto>(`/payments/${id}`), [id]);
  const [tab, setTab] = useState<Tab>("details");
  const [editing, setEditing] = useState(false);

  if (payment.error) {
    return (
      <>
        <h1>Receipt or payment</h1>
        <Alert kind="error">{payment.error}</Alert>
        <Link href="/accounts/payments">Back to receipts and payments</Link>
      </>
    );
  }
  if (!payment.data) return <p className="muted">Loading…</p>;
  const p = payment.data;
  const canEdit = p.status === "draft" && (p.kind === "transfer" ? rights.makeTransfers : rights.makePayments);

  return (
    <>
      <p>
        <Link href="/accounts/payments">← Receipts, payments and transfers</Link>
      </p>
      {canSeeHistory ? (
        <div className="tabs" role="tablist" aria-label="Payment sections">
          {(["details", "history"] as const).map((t) => (
            <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} className="tab" onClick={() => setTab(t)}>
              {t === "details" ? "Details" : "History"}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={canSeeHistory ? `tab-${tab}` : undefined}>
        {tab === "details" ? (
          editing && canEdit ? (
            <PaymentForm
              payment={p}
              onSaved={(saved) => {
                payment.setData(saved);
                setEditing(false);
              }}
              onClose={() => setEditing(false)}
            />
          ) : (
            <PaymentView payment={p} onChanged={payment.setData} onReload={() => void payment.reload()} onEdit={canEdit ? () => setEditing(true) : undefined} />
          )
        ) : (
          <AuditTable path="/audit" withEntity={false} record={{ entityType: "payment", entityId: p.id }} />
        )}
      </div>
    </>
  );
}
