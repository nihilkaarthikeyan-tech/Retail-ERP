// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { settleSchema } from "shared";
import { PrintButton } from "@/components/documents/print-button";
import { OrdersReasonDialog, useOrderStores } from "@/components/purchasing/orders-shared";
import { Alert, Button, DataTable, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { accountName, accountRights, dec, documentHref, documentLabel, type OpenItemDto, PAYMENT_KIND_LABELS, PAYMENT_KIND_SHORT, type PaymentDto, sum, unpaidBills } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { useLoad } from "@/lib/use-load";
import { formatDate, formatDateTime } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { DocStatusBadge, partyText, useChart, useOpenItems, usePartyNames } from "./accounts-shared";
import { LedgerEntryButton } from "./ledger-entry";
import { confirmPosting } from "@/lib/confirm";

/** Links the unused part of a posted payment to the party's unpaid bills (POST /settlements). */
function UseAdvance({ payment, onDone }: { payment: PaymentDto; onDone: () => void }) {
  const items = useOpenItems(payment.partyType, payment.partyId);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bills = unpaidBills(items.data ?? []);

  async function link(b: OpenItemDto) {
    setError(null);
    const k = `${b.itemType}|${b.itemId}`;
    const left = dec(payment.unused);
    const owed = dec(b.owed);
    const amount = amounts[k]?.trim() || (left.lt(owed) ? left : owed).toFixed(2);
    const parsed = settleSchema.safeParse({ partyType: payment.partyType, partyId: payment.partyId, billType: b.itemType, billId: b.itemId, byType: "payment", byId: payment.id, amount });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the amount");
      return;
    }
    setBusy(k);
    try {
      await api.post("/settlements", parsed.data);
      onDone();
      await items.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<OpenItemDto>[] = [
    { key: "bill", header: "Bill", render: (b) => `${documentLabel(b.itemType)} ${b.number ?? ""}` },
    { key: "date", header: "Date", render: (b) => formatDate(b.date) },
    { key: "owed", header: "Still owed", align: "right", render: (b) => rupees(b.owed) },
    {
      key: "amount",
      header: "Use",
      render: (b) => <input className="input" inputMode="decimal" aria-label={`Amount to use for ${b.number ?? b.itemId}`} placeholder="All it can" value={amounts[`${b.itemType}|${b.itemId}`] ?? ""} onChange={(e) => setAmounts((a) => ({ ...a, [`${b.itemType}|${b.itemId}`]: e.target.value }))} />,
    },
    {
      key: "link",
      header: "",
      render: (b) => (
        <Button size="small" busy={busy === `${b.itemType}|${b.itemId}`} disabled={busy !== null} onClick={() => void link(b)}>
          Link
        </Button>
      ),
    },
  ];

  return (
    <section className="card" aria-label="Use the advance">
      <h2>Use the advance against bills</h2>
      <p className="muted">Links part of the unused amount to an unpaid bill. Nothing new is posted; only which bill is paid changes.</p>
      <Alert kind="error">{items.error ?? error}</Alert>
      <DataTable columns={columns} rows={items.data ? bills : null} rowKey={(b) => `${b.itemType}|${b.itemId}`} loading={items.loading} empty="No unpaid bills to link." />
    </section>
  );
}

interface SettlementDto {
  id: string;
  billType: string;
  billId: string;
  billNumber: string | null;
  byType: string;
  byId: string;
  amount: string;
  settledOn: string | null;
  undone: boolean;
}

/** The bills a posted payment is linked to, with the numbers of both, and undoing a wrong link. */
function PaymentLinks({ payment, mayUndo, onChanged }: { payment: PaymentDto; mayUndo: boolean; onChanged: () => void }) {
  const links = useLoad(() => api.get<SettlementDto[]>(`/parties/${payment.partyType}/${payment.partyId}/settlements`), [payment.partyType, payment.partyId]);
  const rows = links.data ? links.data.filter((r) => r.byId === payment.id || r.billId === payment.id) : null;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function undo(id: string) {
    setError(null);
    setBusy(id);
    try {
      await api.post(`/settlements/${id}/undo`);
      await links.reload();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const live = (rows ?? []).filter((r) => !r.undone);
  return (
    <>
      <Alert kind="error">{links.error ?? error}</Alert>
      {rows === null ? <p className="muted">Loading…</p> : live.length === 0 ? <p className="muted">Not linked to any bill.</p> : (
        <ul>
          {live.map((r) => {
            const href = documentHref(r.billType, r.billId);
            const label = `${documentLabel(r.billType)} ${r.billNumber ?? ""}`.trim();
            return (
              <li key={r.id}>
                {href ? <Link href={href}>{label}</Link> : label}: {rupees(r.amount)}
                {mayUndo ? (
                  <>
                    {" "}
                    <Button size="small" variant="link" busy={busy === r.id} disabled={busy !== null} onClick={() => void undo(r.id)} aria-label={`Undo the link to ${label}`}>
                      Undo link
                    </Button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** A receipt, payment or transfer with its bills and deductions, and the actions the user may take. */
export function PaymentView({ payment, onChanged, onReload, onEdit }: { payment: PaymentDto; onChanged: (p: PaymentDto) => void; onReload: () => void; onEdit?: () => void }) {
  const { user } = useAuth();
  const rights = accountRights(user);
  const chart = useChart();
  const { stores } = useOrderStores();
  const names = usePartyNames([{ type: payment.partyType, id: payment.partyId }]);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = payment;
  const mayAct = p.kind === "transfer" ? rights.makeTransfers : rights.makePayments;
  const account = (id: string | null) => (id ? accountName(chart.data?.accounts.find((a) => a.id === id)) : "—");
  const deducted = sum(p.deductions.map((d) => d.amount));

  async function post() {
    setError(null);
    setBusy(true);
    try {
      onChanged(await api.post<PaymentDto>(`/payments/${p.id}/post`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          {PAYMENT_KIND_SHORT[p.kind]} <span className="mono">{p.number ?? "(draft)"}</span>
        </h1>
        <DocStatusBadge status={p.status} />
        <span className="spacer" />
        <PrintButton kind="payment" id={p.id} />
        {p.status !== "draft" ? <LedgerEntryButton documentType="payment" documentId={p.id} /> : null}
      </div>
      {p.status === "cancelled" ? <Alert kind="info">{`Cancelled${p.cancelReason ? `: ${p.cancelReason}` : ""}.${p.postedAt ? " Equal and opposite entries were posted on the same date and the bills it settled owe again." : ""}`}</Alert> : null}
      <div className="card">
        <dl className="kv">
          <dt>What it is</dt>
          <dd>{PAYMENT_KIND_LABELS[p.kind]}</dd>
          <dt>Date</dt>
          <dd>{formatDate(p.paymentDate)}</dd>
          {p.partyId ? (
            <>
              <dt>{p.partyType === "customer" ? "Customer" : "Supplier"}</dt>
              <dd>
                <Link href={`/${p.partyType === "customer" ? "customers" : "suppliers"}/${p.partyId}`}>{partyText(names[p.partyId])}</Link>
              </dd>
            </>
          ) : null}
          {p.kind !== "receipt" ? (
            <>
              <dt>{p.kind === "transfer" ? "From" : "Paid from"}</dt>
              <dd>{account(p.fromAccountId)}</dd>
            </>
          ) : null}
          {p.kind !== "payment" ? (
            <>
              <dt>{p.kind === "transfer" ? "To" : "Received into"}</dt>
              <dd>{account(p.toAccountId)}</dd>
            </>
          ) : null}
          <dt>Amount</dt>
          <dd>
            <strong>{rupees(p.amount)}</strong>
          </dd>
          {p.deductions.length ? (
            <>
              <dt>Deductions</dt>
              <dd>
                {p.deductions.map((d, i) => (
                  <div key={i}>
                    {account(d.accountId)}: {rupees(d.amount)}
                    {d.remark ? <span className="muted"> · {d.remark}</span> : null}
                  </div>
                ))}
                {p.kind === "transfer" ? <div className="muted">Reaches the other account: {rupees(dec(p.amount).sub(deducted).toFixed(2))}</div> : null}
              </dd>
            </>
          ) : null}
          <dt>Store</dt>
          <dd>{p.storeId ? (stores.find((s) => s.id === p.storeId)?.code ?? "…") : "Head office"}</dd>
          <dt>Cheque / transfer number</dt>
          <dd>
            {p.reference ?? "—"}
            {p.referenceDate ? ` of ${formatDate(p.referenceDate)}` : ""}
          </dd>
          {p.remark ? (
            <>
              <dt>Remark</dt>
              <dd>{p.remark}</dd>
            </>
          ) : null}
          {p.kind !== "transfer" ? (
            <>
              <dt>Unused (advance)</dt>
              <dd aria-label="Unused amount">{rupees(p.unused)}</dd>
            </>
          ) : null}
          {p.postedAt ? (
            <>
              <dt>Posted</dt>
              <dd>{formatDateTime(p.postedAt)}</dd>
            </>
          ) : null}
        </dl>
      </div>
      {p.kind !== "transfer" ? (
        <>
          <h2>Bills it settles</h2>
          {p.status === "posted" && p.partyType && p.partyId ? (
            <PaymentLinks payment={p} mayUndo={rights.payments} onChanged={onReload} />
          ) : p.allocations.length === 0 ? (
            <p className="muted">{p.status === "draft" ? "No bills chosen yet. When saved with “oldest first”, bills are chosen automatically." : "Not linked to any bill."}</p>
          ) : (
            <ul>
              {p.allocations.map((a) => {
                const href = documentHref(a.billType, a.billId);
                return (
                  <li key={`${a.billType}|${a.billId}`}>
                    {href ? <Link href={href}>{documentLabel(a.billType)}</Link> : documentLabel(a.billType)}: {rupees(a.amount)}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
      <Alert kind="error">{error}</Alert>
      {mayAct ? (
        <div className="actions">
          {p.status === "draft" ? (
            <>
              <Button variant="primary" busy={busy} onClick={() => confirmPosting("Post this payment", "The money and what it settles go into the accounts now.") && post()}>
                Post
              </Button>
              {onEdit ? <Button onClick={onEdit}>Change draft</Button> : null}
            </>
          ) : null}
          {p.status !== "cancelled" ? (
            <Button variant="danger" onClick={() => setCancelling(true)}>
              {p.status === "draft" ? "Cancel draft" : "Cancel it"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {p.status === "posted" && p.partyId && dec(p.unused).gt(0) && rights.payments ? <UseAdvance payment={p} onDone={onReload} /> : null}
      <OrdersReasonDialog
        open={cancelling}
        title={p.status === "draft" ? "Cancel this draft" : `Cancel this ${PAYMENT_KIND_SHORT[p.kind].toLowerCase()}`}
        explain={p.status === "draft" ? "The draft is kept in the list as cancelled. Nothing was posted yet." : "Equal and opposite entries are posted on the same date, and the bills it settled owe again. Both entries stay visible in the ledger."}
        confirmLabel="Cancel it"
        danger
        onClose={() => setCancelling(false)}
        onConfirm={async (reason) => onChanged(await api.post<PaymentDto>(`/payments/${p.id}/cancel`, { reason }))}
      />
    </>
  );
}
