// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { Decimal, INDIAN_STATES } from "shared";
import { Alert, Badge, Button, DataTable, type Column } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime } from "@/lib/format";
import { ACCOUNT_ROLE_LABELS, BILL_KIND_LABELS, BILL_PAYMENT_LABELS, BILL_STATUS_LABELS, purchaseRights, rupees, statusTone, type SupplierBillDto, type SupplierBillLineDto } from "@/lib/purchasing";
import { showQuantity } from "@/lib/stock";
import { LedgerEntryButton } from "@/components/accounts/ledger-entry";
import { PrintButton } from "@/components/documents/print-button";
import { BillCancelDialog, BillDebitNoteDialog, BillHoldDialog, heldText, PriceDifferenceDialog } from "./bills-dialogs";
import { useUnitCodes } from "./bills-line-grid";
import { confirmPosting } from "@/lib/confirm";

/** "Tamil Nadu (33)" for a GST state code. */
const stateLabel = (code: string) => `${INDIAN_STATES[code] ?? code} (${code})`;

interface BillViewProps {
  bill: SupplierBillDto;
  /** After finalising, cancelling, holding or releasing. */
  onChanged: (bill: SupplierBillDto) => void;
  /** Draft bills: switch to the editor. */
  onEdit?: () => void;
  /** A debit note was made from this bill. */
  onDebitNote?: (note: SupplierBillDto) => void;
}

/** Status (paid, part paid or not paid once finalised), overdue and held badges of a bill. */
export function BillBadges({ bill }: { bill: Pick<SupplierBillDto, "status" | "overdue" | "held" | "paymentStatus"> }) {
  return (
    <>
      {bill.status === "unpaid" && bill.paymentStatus ? (
        <Badge kind={bill.paymentStatus === "paid" ? "ok" : bill.paymentStatus === "part_paid" ? "warn" : statusTone(bill.status)}>{BILL_PAYMENT_LABELS[bill.paymentStatus]}</Badge>
      ) : (
        <Badge kind={statusTone(bill.status)}>{BILL_STATUS_LABELS[bill.status]}</Badge>
      )}
      {bill.overdue ? (
        <>
          {" "}
          <Badge kind="off">Overdue</Badge>
        </>
      ) : null}
      {bill.held ? (
        <>
          {" "}
          <Badge kind="neutral">Held</Badge>
        </>
      ) : null}
    </>
  );
}

function nonZero(v: string | undefined): boolean {
  if (!v) return false;
  try {
    return !new Decimal(v).isZero();
  } catch {
    return false;
  }
}

/** A supplier bill or debit note: details, lines, amounts and the actions the user may take. */
export function BillView({ bill, onChanged, onEdit, onDebitNote }: BillViewProps) {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const unitCodes = useUnitCodes(bill.lines.map((l) => l.item.id));
  const [dialog, setDialog] = useState<"cancel" | "hold" | "debit" | null>(null);
  const [priceMessage, setPriceMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"finalise" | "release" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const isNote = bill.kind === "debit_note";
  const draft = bill.status === "draft";
  const unpaid = bill.status === "unpaid";
  const canBill = rights.bill;
  const canCancel = bill.status !== "cancelled" && (isNote ? rights.returns : rights.bill);
  const somethingLeft = bill.lines.some((l) => new Decimal(l.quantity).gt(l.returnedQuantity));
  const canDebit = unpaid && !isNote && rights.returns && somethingLeft;
  const withPrices = bill.total !== undefined;
  const anyDifference = bill.lines.some((l) => nonZero(l.priceDifference));

  async function finalise(confirmPriceDifference: boolean) {
    setError(null);
    setBusy("finalise");
    try {
      const done = await api.post<SupplierBillDto>(`/purchase/bills/${bill.id}/finalise`, confirmPriceDifference ? { confirmPriceDifference: true } : {});
      setPriceMessage(null);
      setWarnings(done.warnings ?? []);
      onChanged(done);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 400 && err.message.startsWith("PRICE_DIFFERENCE:")) {
        setPriceMessage(err.message);
      } else {
        setPriceMessage(null);
        setError(errorMessage(err));
      }
    } finally {
      setBusy(null);
    }
  }

  async function release() {
    setError(null);
    setBusy("release");
    try {
      onChanged(await api.post<SupplierBillDto>(`/purchase/bills/${bill.id}/release`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<SupplierBillLineDto>[] = [
    { key: "no", header: "#", render: (l) => l.lineNo },
    {
      key: "item",
      header: "Item",
      render: (l) => (
        <>
          <span className="mono">{l.item.code}</span> {l.item.name}
          {l.receipt || l.order ? (
            <div className="muted">
              {l.receipt ? (
                <>
                  Receipt <Link href={`/purchases/receipts/${l.receipt.id}`}>{l.receipt.number}</Link>
                </>
              ) : null}
              {l.receipt && l.order ? " · " : null}
              {l.order ? (
                <>
                  Order <Link href={`/purchases/orders/${l.order.id}`}>{l.order.number}</Link>
                </>
              ) : null}
            </div>
          ) : null}
        </>
      ),
    },
    {
      key: "qty",
      header: "Quantity",
      align: "right",
      render: (l) => (
        <>
          {showQuantity(l.quantity)} {unitCodes[l.unitId] ?? ""}
          {nonZero(l.freeQuantity) ? <div className="muted">+ {showQuantity(l.freeQuantity)} free</div> : null}
          {nonZero(l.returnedQuantity) ? <div className="muted">{showQuantity(l.returnedQuantity)} sent back</div> : null}
        </>
      ),
    },
    ...(withPrices
      ? ([
          { key: "rate", header: "Price per unit", align: "right", render: (l) => rupees(l.rate) },
          { key: "disc", header: "Discount %", align: "right", render: (l) => (nonZero(l.discountPercent) ? showQuantity(l.discountPercent) : "—") },
          { key: "taxable", header: "Before GST", align: "right", render: (l) => rupees(l.taxableAmount) },
          {
            key: "gst",
            header: "GST",
            align: "right",
            render: (l) => (
              <>
                {showQuantity(l.gstRate)}%
                <div className="muted">{nonZero(l.igst) ? `IGST ${rupees(l.igst)}` : `CGST ${rupees(l.cgst)} · SGST ${rupees(l.sgst)}`}</div>
                {l.creditClaimable === false ? <div className="muted">No input credit: added to cost</div> : null}
              </>
            ),
          },
          { key: "total", header: "Line total", align: "right", render: (l) => rupees(l.lineTotal) },
        ] satisfies Column<SupplierBillLineDto>[])
      : []),
    ...(anyDifference
      ? ([{ key: "diff", header: "Price difference", align: "right", render: (l) => (nonZero(l.priceDifference) ? rupees(l.priceDifference) : "—") }] satisfies Column<SupplierBillLineDto>[])
      : []),
    { key: "account", header: "Booked to", render: (l) => ACCOUNT_ROLE_LABELS[l.accountRole] ?? l.accountRole },
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          {isNote ? "Debit note" : "Supplier bill"} <span className="mono">{bill.number}</span>
        </h1>
        <BillBadges bill={bill} />
        <span className="spacer" />
        {/* Audit 4 (T14): a purchase on reverse charge from an unregistered supplier needs our own self-invoice. */}
        {!draft && !isNote && bill.reverseCharge ? <PrintButton kind="rcm_self_invoice" id={bill.id} label="Self-invoice" title="The tax invoice the shop issues itself for a reverse-charge purchase from an unregistered supplier (section 31(3)(f))" /> : null}
        {!draft ? <LedgerEntryButton documentType="supplier_bill" documentId={bill.id} /> : null}
      </div>
      {bill.status === "cancelled" ? <Alert kind="info">{`Cancelled${bill.cancelReason ? `: ${bill.cancelReason}` : ""}.`}</Alert> : null}
      {bill.held ? <Alert kind="info">{heldText(bill)}</Alert> : null}
      {warnings.length > 0 ? (
        <Alert kind="info">
          <strong>Finalised, with notes:</strong>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="card">
        <dl className="kv">
          <dt>Kind</dt>
          <dd>{BILL_KIND_LABELS[bill.kind]}</dd>
          <dt>Supplier</dt>
          <dd>
            <span className="mono">{bill.supplier.code}</span> — {bill.supplier.name}
          </dd>
          <dt>{isNote ? "Supplier's note number" : "Supplier's bill number"}</dt>
          <dd className="mono">{bill.supplierBillNo}</dd>
          <dt>{isNote ? "Note date" : "Supplier's bill date"}</dt>
          <dd>{formatDate(bill.supplierBillDate)}</dd>
          <dt>Posting date</dt>
          <dd>{formatDate(bill.postingDate)}</dd>
          {bill.placeOfSupply ? (
            <>
              <dt>Place of supply</dt>
              <dd>{stateLabel(bill.placeOfSupply)}</dd>
            </>
          ) : null}
          {bill.reverseCharge ? (
            <>
              <dt>Reverse charge</dt>
              <dd>
                <Badge kind="warn">Yes</Badge> The shop pays this bill&apos;s GST to the government itself; the supplier is paid without GST.
              </dd>
            </>
          ) : null}
          {!isNote ? (
            <>
              <dt>Due date</dt>
              <dd>
                {formatDate(bill.dueDate)} {bill.overdue ? <Badge kind="off">Overdue</Badge> : null}
              </dd>
              {bill.amountDue !== undefined ? (
                <>
                  <dt>Still owed</dt>
                  <dd>{rupees(bill.amountDue)}</dd>
                </>
              ) : null}
            </>
          ) : null}
          {bill.returnOfId ? (
            <>
              <dt>Debit note for</dt>
              <dd>
                <Link href={`/purchases/bills/${bill.returnOfId}`}>the original bill</Link>
              </dd>
            </>
          ) : null}
          {bill.receiptId ? (
            <>
              <dt>{isNote ? "Goods sent back" : "Goods receipt"}</dt>
              <dd>
                <Link href={`/purchases/receipts/${bill.receiptId}`}>{isNote ? "the return of goods" : draft ? "draft receipt (posted when the bill is finalised)" : "the goods received with this bill"}</Link>
              </dd>
            </>
          ) : null}
          {bill.finalisedAt ? (
            <>
              <dt>Finalised</dt>
              <dd>{formatDateTime(bill.finalisedAt)}</dd>
            </>
          ) : null}
          {bill.remarks ? (
            <>
              <dt>{isNote ? "Reason" : "Remarks"}</dt>
              <dd>{bill.remarks}</dd>
            </>
          ) : null}
        </dl>
      </div>

      <DataTable columns={columns} rows={bill.lines} rowKey={(l) => l.id} empty="No lines." />

      {withPrices ? (
        <div className="card" aria-label="Bill amounts">
          <dl className="kv">
            <dt>Before GST</dt>
            <dd>{rupees(bill.taxableAmount)}</dd>
            <dt>{bill.reverseCharge ? "GST paid by the shop (reverse charge)" : "GST"}</dt>
            <dd>{rupees(bill.taxAmount)}</dd>
            <dt>Rounding</dt>
            <dd>{rupees(bill.roundingAdjustment)}</dd>
            <dt>Total</dt>
            <dd>
              <strong>{rupees(bill.total)}</strong>
            </dd>
            {nonZero(bill.priceDifference) ? (
              <>
                <dt>Price difference from the receipts</dt>
                <dd>{rupees(bill.priceDifference)}</dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}

      <Alert kind="error">{error}</Alert>
      <div className="actions">
        {draft && canBill && !isNote ? (
          <>
            <Button variant="primary" busy={busy === "finalise"} onClick={() => confirmPosting("Finalise this supplier bill", "What is owed to the supplier, and the GST, go into the accounts now.") && finalise(false)}>
              Finalise
            </Button>
            {onEdit ? <Button onClick={onEdit}>Change draft</Button> : null}
          </>
        ) : null}
        {unpaid && !isNote && canBill && !bill.held ? <Button onClick={() => setDialog("hold")}>Hold</Button> : null}
        {bill.held && canBill ? (
          <Button busy={busy === "release"} onClick={release}>
            Release hold
          </Button>
        ) : null}
        {canDebit ? <Button onClick={() => setDialog("debit")}>Make debit note</Button> : null}
        {canCancel ? (
          <Button variant="danger" onClick={() => setDialog("cancel")}>
            {draft ? "Cancel draft" : isNote ? "Cancel debit note" : "Cancel bill"}
          </Button>
        ) : null}
      </div>
      <p className="muted">Payments to the supplier are recorded under Accounts, Receipts and payments.</p>

      <PriceDifferenceDialog message={priceMessage ?? ""} open={priceMessage !== null} busy={busy === "finalise"} onConfirm={() => finalise(true)} onClose={() => setPriceMessage(null)} />
      {dialog === "cancel" ? <BillCancelDialog bill={bill} open onClose={() => setDialog(null)} onDone={onChanged} /> : null}
      {dialog === "hold" ? <BillHoldDialog bill={bill} open onClose={() => setDialog(null)} onDone={onChanged} /> : null}
      {dialog === "debit" ? <BillDebitNoteDialog bill={bill} open onClose={() => setDialog(null)} onDone={(note) => onDebitNote?.(note)} /> : null}
    </>
  );
}
