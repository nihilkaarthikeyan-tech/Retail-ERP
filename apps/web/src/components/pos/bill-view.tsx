// Copyright (c) 2026, Rademics. All rights reserved.
// One till bill: lines with GST, payments, check flags, reprint and cancel.
"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, Button, DataTable, Dialog, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { showQuantity } from "@/lib/stock";
import type { CustomerDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { CancelBillDialog } from "./cancel-bill-dialog";
import { type BillPage, flagLabel, type PosBillDto, type PosBillLineDto, posRights, type ReceiptDto, type TillPeople } from "./pos-shared";
import { ReceiptPreview } from "./receipt-preview";

/** Who is who, as far as this user may know (cashier names come from the till's people list). */
function useNames(bill: PosBillDto, canSell: boolean) {
  const people = useLoad<TillPeople | null>(() => (canSell ? api.get<TillPeople>(`/pos/tills/${bill.till.id}/people`).catch(() => null) : Promise.resolve(null)), [bill.till.id, canSell]);
  const customer = useLoad<CustomerDto | null>(() => (bill.customerId ? api.get<CustomerDto>(`/customers/${bill.customerId}`).catch(() => null) : Promise.resolve(null)), [bill.customerId]);
  // The other half of an exchange is on the same shift.
  const partner = useLoad<PosBillDto | null>(
    () =>
      bill.exchangeId
        ? api
            .get<BillPage>(`/pos/bills${query({ shiftId: bill.shiftId, pageSize: 200 })}`)
            .then((p) => p.rows.find((b) => b.exchangeId === bill.exchangeId && b.id !== bill.id) ?? null)
            .catch(() => null)
        : Promise.resolve(null),
    [bill.id, bill.exchangeId],
  );
  const everyone = [...(people.data?.cashiers ?? []), ...(people.data?.managers ?? [])];
  const nameOf = (id: string | null) => (id ? (everyone.find((p) => p.id === id)?.name ?? null) : null);
  return { nameOf, customer: customer.data, partner: partner.data };
}

export function BillView({ bill, onChanged }: { bill: PosBillDto; onChanged: () => void }) {
  const { user } = useAuth();
  const rights = posRights(user);
  const { nameOf, customer, partner } = useNames(bill, rights.sell);
  const [receipt, setReceipt] = useState<ReceiptDto | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelled = bill.status === "cancelled";

  async function reprint() {
    setError(null);
    setBusy(true);
    try {
      setReceipt(await api.post<ReceiptDto>(`/pos/bills/${bill.id}/reprint`));
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const lineColumns: Column<PosBillLineDto>[] = [
    { key: "no", header: "#", render: (l) => l.lineNo },
    {
      key: "item",
      header: "Item",
      render: (l) => (
        <>
          <span className="mono">{l.item.code}</span> {l.item.name} {l.isFree ? <Badge kind="ok">Free</Badge> : null}
          {l.offerName ? <div className="muted">{l.offerName}</div> : null}
          {l.salesStaff ? <div className="muted">Sold by {l.salesStaff.name}</div> : null}
          {l.serialNumbers.length ? <div className="muted">S/N {l.serialNumbers.join(", ")}</div> : null}
        </>
      ),
    },
    { key: "hsn", header: "HSN", render: (l) => <span className="mono">{l.item.hsnCode ?? "—"}</span> },
    { key: "qty", header: "Qty", align: "right", render: (l) => showQuantity(l.quantity) },
    { key: "mrp", header: "MRP", align: "right", render: (l) => rupees(l.mrp) },
    { key: "price", header: "Price", align: "right", render: (l) => rupees(l.price) },
    {
      key: "discount",
      header: "Discount",
      align: "right",
      render: (l) => (
        <>
          {rupees(l.discountAmount)}
          {l.offerId && l.offerDiscount !== "0.00" ? <div className="muted">offer {rupees(l.offerDiscount)}</div> : null}
          {l.approvedById ? <div className="muted">approved by {nameOf(l.approvedById) ?? "a manager"}</div> : null}
        </>
      ),
    },
    { key: "taxable", header: "Before GST", align: "right", render: (l) => rupees(l.taxableAmount) },
    { key: "rate", header: "GST %", align: "right", render: (l) => showQuantity(l.gstRate) },
    { key: "cgst", header: "CGST", align: "right", render: (l) => rupees(l.cgst) },
    { key: "sgst", header: "SGST", align: "right", render: (l) => rupees(l.sgst) },
    { key: "igst", header: "IGST", align: "right", render: (l) => rupees(l.igst) },
    { key: "total", header: "Amount", align: "right", render: (l) => rupees(l.lineTotal) },
    ...(bill.kind === "sale" && bill.lines.some((l) => showQuantity(l.returnedQuantity) !== "0")
      ? ([{ key: "returned", header: "Returned", align: "right", render: (l: PosBillLineDto) => showQuantity(l.returnedQuantity) }] satisfies Column<PosBillLineDto>[])
      : []),
  ];

  type Payment = PosBillDto["payments"][number] & { key: string };
  const payColumns: Column<Payment>[] = [
    { key: "method", header: "Paid by", render: (p) => p.paymentMethod.name },
    { key: "ref", header: "Reference", render: (p) => p.reference ?? <span className="muted">—</span> },
    { key: "amount", header: "Amount", align: "right", render: (p) => rupees(p.amount) },
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          {bill.kind === "return" ? "Return" : "Bill"} <span className="mono">{bill.number}</span>
        </h1>
        {cancelled ? <Badge kind="off">Cancelled</Badge> : <Badge kind="ok">Completed</Badge>}
        {bill.offline ? <Badge kind="warn">Made offline</Badge> : null}
        {bill.gstProvisional ? <Badge kind="neutral">GST provisional</Badge> : null}
        <span className="spacer" />
        {rights.sell ? (
          <Button onClick={() => void reprint()} busy={busy}>
            Reprint
          </Button>
        ) : null}
        {rights.sell && !cancelled ? (
          <Button variant="danger" onClick={() => setCancelling(true)}>
            Cancel bill
          </Button>
        ) : null}
      </div>
      <Alert kind="error">{error}</Alert>
      {cancelled ? <Alert kind="info">Cancelled: {bill.cancelReason ?? "no reason given"}.</Alert> : null}
      {bill.checkFlags.length ? (
        <Alert kind="info">
          To check:
          <ul>
            {bill.checkFlags.map((f) => (
              <li key={f}>{flagLabel(f)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="card">
        <dl className="kv">
          <dt>Date</dt>
          <dd>
            {formatDate(bill.businessDate)} <span className="muted">({formatDateTime(bill.soldAt)})</span>
          </dd>
          <dt>Till</dt>
          <dd>
            <span className="mono">{bill.till.code}</span> {bill.till.name}
          </dd>
          <dt>Cashier</dt>
          <dd>{nameOf(bill.cashierId) ?? <span className="muted">—</span>}</dd>
          <dt>Customer</dt>
          <dd>{customer ? <Link href={`/customers/${customer.id}`}>{customer.name}</Link> : <span className="muted">Walk-in</span>}</dd>
          {bill.returnOfId ? (
            <>
              <dt>Return of</dt>
              <dd>
                <Link href={`/pos/bills/${bill.returnOfId}`}>the original bill</Link>
              </dd>
            </>
          ) : null}
          {bill.kind === "return" && !bill.returnOfId ? (
            <>
              <dt>Return of</dt>
              <dd>Returned without a bill (manager approved)</dd>
            </>
          ) : null}
          {bill.returnReason ? (
            <>
              <dt>Return reason</dt>
              <dd>{bill.returnReason}</dd>
            </>
          ) : null}
          {bill.exchangeId ? (
            <>
              <dt>Exchange</dt>
              <dd>
                {partner ? (
                  <>
                    Made together with {partner.kind === "return" ? "return" : "bill"} <Link href={`/pos/bills/${partner.id}`}>{partner.number}</Link>
                  </>
                ) : (
                  "Part of an exchange"
                )}
              </dd>
            </>
          ) : null}
          {bill.salesStaff ? (
            <>
              <dt>Salesperson</dt>
              <dd>
                {bill.salesStaff.name} <span className="mono muted">{bill.salesStaff.code}</span>
              </dd>
            </>
          ) : null}
          {bill.offers?.length ? (
            <>
              <dt>Offers</dt>
              <dd>
                {bill.offers.map((o) => (
                  <div key={o.id}>
                    {o.name}: saved {rupees(o.saving)}
                  </div>
                ))}
              </dd>
            </>
          ) : null}
          {bill.delivery ? (
            <>
              <dt>Home delivery</dt>
              <dd>
                {bill.delivery.name ? `${bill.delivery.name}, ` : ""}
                {bill.delivery.address}
                {bill.delivery.phone ? `, ${bill.delivery.phone}` : ""}
                {bill.delivery.deliverOn ? ` on ${formatDate(bill.delivery.deliverOn)}` : ""}{" "}
                <Badge kind={bill.delivery.status === "delivered" ? "ok" : bill.delivery.status === "pending" ? "warn" : "off"}>{bill.delivery.status === "delivered" ? "Delivered" : bill.delivery.status === "pending" ? "Pending" : "Cancelled"}</Badge>
              </dd>
            </>
          ) : null}
          <dt>Printed again</dt>
          <dd>{bill.reprints ? `${bill.reprints} time${bill.reprints === 1 ? "" : "s"}` : "No"}</dd>
        </dl>
      </div>

      <DataTable columns={lineColumns} rows={bill.lines} rowKey={(l) => l.id} />

      <div className="editor-grid">
        <div>
          <h2>Payments</h2>
          <DataTable columns={payColumns} rows={bill.payments.map((p, i) => ({ ...p, key: `${i}` }))} rowKey={(p) => p.key} empty="No payments." />
        </div>
        <div className="card">
          <dl className="kv">
            <dt>Gross</dt>
            <dd className="num">{rupees(bill.grossAmount)}</dd>
            <dt>Discount</dt>
            <dd className="num">{rupees(bill.discountAmount)}</dd>
            <dt>Before GST</dt>
            <dd className="num">{rupees(bill.taxableAmount)}</dd>
            <dt>CGST</dt>
            <dd className="num">{rupees(bill.cgst)}</dd>
            <dt>SGST</dt>
            <dd className="num">{rupees(bill.sgst)}</dd>
            {bill.igst !== "0.00" ? (
              <>
                <dt>IGST</dt>
                <dd className="num">{rupees(bill.igst)}</dd>
              </>
            ) : null}
            <dt>Rounding</dt>
            <dd className="num">{rupees(bill.roundingAdjustment)}</dd>
            <dt>Total</dt>
            <dd className="num">
              <strong>{rupees(bill.total)}</strong>
            </dd>
            <dt>Change given</dt>
            <dd className="num">{rupees(bill.changeAmount)}</dd>
          </dl>
        </div>
      </div>

      <Dialog open={receipt !== null} title={`Receipt ${bill.number}`} onClose={() => setReceipt(null)}>
        {receipt ? <ReceiptPreview receipt={receipt} /> : null}
      </Dialog>
      {cancelling ? (
        <CancelBillDialog
          bill={bill}
          open
          onClose={() => setCancelling(false)}
          onCancelled={() => {
            setCancelling(false);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}
