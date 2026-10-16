// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { DocStatusBadge, partyText, usePartyNames } from "@/components/accounts/accounts-shared";
import { Alert, DataTable, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { accountRights, dec, DOC_STATUS_LABELS, type DocStatus, PAYMENT_KIND_SHORT, type PaymentDto, type PaymentKind } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";

export default function PaymentsPage() {
  const { user } = useAuth();
  const rights = accountRights(user);
  const [f, setF] = useState({ status: "", kind: "", from: "", to: "", search: "" });
  const payments = useLoad(() => api.get<PaymentDto[]>(`/payments${query(f)}`), [f.status, f.kind, f.from, f.to, f.search]);
  const names = usePartyNames((payments.data ?? []).map((p) => ({ type: p.partyType, id: p.partyId })));
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const columns: Column<PaymentDto>[] = [
    {
      key: "number",
      header: "Number",
      render: (p) => (
        <Link href={`/accounts/payments/${p.id}`} className="mono">
          {p.number ?? "Draft"}
        </Link>
      ),
    },
    { key: "date", header: "Date", render: (p) => formatDate(p.paymentDate) },
    { key: "kind", header: "What", render: (p) => PAYMENT_KIND_SHORT[p.kind] },
    { key: "party", header: "Customer / supplier", render: (p) => (p.partyId ? partyText(names[p.partyId]) : "—") },
    { key: "amount", header: "Amount", align: "right", render: (p) => rupees(p.amount) },
    { key: "unused", header: "Unused (advance)", align: "right", render: (p) => (p.kind === "transfer" || dec(p.unused).isZero() ? "—" : rupees(p.unused)) },
    { key: "status", header: "Status", render: (p) => <DocStatusBadge status={p.status} /> },
  ];

  return (
    <>
      <h1>Receipts, payments and transfers</h1>
      {rights.makeTransfers ? (
        <div className="toolbar">
          <Link href="/accounts/payments/new" className="btn btn-primary">
            {rights.makePayments ? "New receipt, payment or transfer" : "New transfer (cash to bank)"}
          </Link>
        </div>
      ) : null}
      <div className="filter-row">
        <SelectInput id="pay-f-status" label="Status" value={f.status} onChange={(e) => set("status", e.target.value)}>
          <option value="">All</option>
          {(Object.keys(DOC_STATUS_LABELS) as DocStatus[]).map((s) => (
            <option key={s} value={s}>
              {DOC_STATUS_LABELS[s]}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="pay-f-kind" label="What" value={f.kind} onChange={(e) => set("kind", e.target.value)}>
          <option value="">All</option>
          {(Object.keys(PAYMENT_KIND_SHORT) as PaymentKind[]).map((k) => (
            <option key={k} value={k}>
              {PAYMENT_KIND_SHORT[k]}
            </option>
          ))}
        </SelectInput>
        <TextInput id="pay-f-from" label="From" type="date" value={f.from} onChange={(e) => set("from", e.target.value)} />
        <TextInput id="pay-f-to" label="To" type="date" value={f.to} onChange={(e) => set("to", e.target.value)} />
        <TextInput id="pay-f-search" label="Search" value={f.search} onChange={(e) => set("search", e.target.value)} hint="Number or cheque / transfer number." />
      </div>
      <Alert kind="error">{payments.error}</Alert>
      <DataTable columns={columns} rows={payments.data} rowKey={(p) => p.id} loading={payments.loading} empty="Nothing matches." />
    </>
  );
}
