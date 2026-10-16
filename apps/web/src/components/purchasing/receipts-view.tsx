// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CHECK_RESULTS, Decimal, receiptCheckSchema } from "shared";
import { LedgerEntryButton } from "@/components/accounts/ledger-entry";
import { BackDatedBadge } from "@/components/stock/stock-doc-parts";
import { Alert, Button, DataTable, RadioInput, TextareaInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime } from "@/lib/format";
import { CHECK_RESULT_LABELS, type GoodsReceiptDto, type GoodsReceiptLineDto, purchaseRights, rupees } from "@/lib/purchasing";
import { indianTime, showQuantity } from "@/lib/stock";
import type { StockLocationDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { ReasonDialog, ReceiptStatusBadge } from "./receipts-parts";
import { inLineUnit, leftToReturn, ReceiptsReturnDialog } from "./receipts-return-dialog";

interface ReceiptViewProps {
  receipt: GoodsReceiptDto;
  locations: StockLocationDto[];
  onChanged: (receipt: GoodsReceiptDto) => void;
}

function q(value: string): string {
  return showQuantity(value);
}

/** Received-goods check (decision 29): who checked, when, the result and remarks. */
function CheckPanel({ receipt, canCheck, onChanged }: { receipt: GoodsReceiptDto; canCheck: boolean; onChanged: (r: GoodsReceiptDto) => void }) {
  const [result, setResult] = useState<string>(receipt.check?.result ?? "");
  const [remarks, setRemarks] = useState(receipt.check?.remarks ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    if (!result) {
      setError("Choose the result of the check.");
      return;
    }
    if (result !== "passed" && !remarks.trim()) {
      setError("Write what was wrong in the remarks.");
      return;
    }
    const parsed = receiptCheckSchema.safeParse({ result, remarks: remarks.trim() || null });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join("; "));
      return;
    }
    setBusy(true);
    try {
      const after = await api.post<GoodsReceiptDto>(`/purchase/receipts/${receipt.id}/check`, parsed.data);
      setSaved("Check recorded.");
      onChanged(after);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Received-goods check</h2>
      {receipt.check ? (
        <p>
          <strong>{CHECK_RESULT_LABELS[receipt.check.result] ?? receipt.check.result}</strong>
          {receipt.check.checkedAt ? <span className="muted"> · {formatDateTime(receipt.check.checkedAt)}</span> : null}
          {receipt.check.remarks ? ` — ${receipt.check.remarks}` : ""}
        </p>
      ) : (
        <p className="muted">Not checked yet.</p>
      )}
      {canCheck ? (
        <form onSubmit={submit} noValidate>
          <fieldset className="check-list">
            <legend>Result</legend>
            {CHECK_RESULTS.map((r) => (
              <RadioInput key={r} id={`check-${r}`} name="check-result" label={CHECK_RESULT_LABELS[r]} checked={result === r} onChange={() => setResult(r)} />
            ))}
          </fieldset>
          <TextareaInput id="check-remarks" label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={500} hint="What was checked, and anything wrong (needed unless it passed)." />
          <Alert kind="error">{error}</Alert>
          <Alert kind="success">{saved}</Alert>
          <div className="actions">
            <Button type="submit" busy={busy}>
              {receipt.check ? "Record the check again" : "Record the check"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** A finalised, cancelled or returned goods receipt (or a return), or a draft the user cannot change. */
export function ReceiptView({ receipt: r, locations, onChanged }: ReceiptViewProps) {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const [returnOpen, setReturnOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [createdReturn, setCreatedReturn] = useState<GoodsReceiptDto | null>(null);
  const original = useLoad<GoodsReceiptDto | null>(() => (r.returnOfId ? api.get<GoodsReceiptDto>(`/purchase/receipts/${r.returnOfId}`) : Promise.resolve(null)), [r.returnOfId]);
  const loc = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? "—") : "—");

  const prices = r.lines.some((l) => l.lineTotal !== undefined);
  const costs = r.lines.some((l) => l.unitCost !== undefined);
  const anyBatch = r.lines.some((l) => l.item.trackBatches);
  const anySerial = r.lines.some((l) => l.serialNumbers.length > 0 || l.rejectedSerialNumbers.length > 0);
  const finalised = !["draft", "cancelled"].includes(r.status);
  const anythingLeft = r.lines.some((l) => {
    const left = leftToReturn(l);
    return left.accepted.gt(0) || left.rejected.gt(0);
  });
  const canReturn = !r.isReturn && finalised && r.status !== "returned" && rights.returns && anythingLeft;
  const canClose = !r.isReturn && (r.status === "to_bill" || r.status === "partly_billed") && rights.bill;
  const canCancel = !r.billId && r.status !== "cancelled" && (r.isReturn ? rights.returns : rights.receive);
  const title = r.isReturn ? "Return to supplier" : "Goods receipt";

  const columns: Column<GoodsReceiptLineDto>[] = [
    { key: "no", header: "#", render: (l) => l.lineNo },
    {
      key: "item",
      header: "Item",
      render: (l) => (
        <>
          <span className="mono">{l.item.code}</span> {l.item.name}
          {l.order ? (
            <p className="muted">
              Order <Link href={`/purchases/orders/${l.order.id}`}>{l.order.number}</Link>
            </p>
          ) : null}
        </>
      ),
    },
    { key: "accepted", header: r.isReturn ? "Accepted back" : "Accepted", align: "right", render: (l) => q(new Decimal(l.acceptedQuantity).abs().toString()) },
    { key: "rejected", header: r.isReturn ? "Rejected back" : "Rejected", align: "right", render: (l) => q(new Decimal(l.rejectedQuantity).abs().toString()) },
    ...(r.isReturn
      ? []
      : ([
          { key: "free", header: "Free", align: "right", render: (l) => q(l.freeQuantity) },
          {
            key: "returned",
            header: "Returned",
            align: "right",
            render: (l) => q(inLineUnit(new Decimal(l.returnedAcceptedQuantity).add(l.returnedRejectedQuantity).toString(), l.factor).toString()),
          },
          { key: "billed", header: "Billed", align: "right", render: (l) => q(inLineUnit(l.billedQuantity, l.factor).toString()) },
          { key: "tobill", header: "Still to bill", align: "right", render: (l) => q(inLineUnit(l.billableQuantity, l.factor).toString()) },
          { key: "shelf", header: "Shelf", render: (l) => loc(l.shelfLocationId) },
        ] satisfies Column<GoodsReceiptLineDto>[])),
    ...(anyBatch
      ? [
          {
            key: "batch",
            header: "Batch",
            render: (l: GoodsReceiptLineDto) =>
              !l.item.trackBatches ? "—" : l.newBatchNumber ? (
                <>
                  <span className="mono">{l.newBatchNumber}</span>
                  {l.newExpiryOn ? <span className="muted"> · expires {formatDate(l.newExpiryOn)}</span> : null}
                </>
              ) : l.batchId ? (
                <span className="muted">recorded</span>
              ) : (
                <span className="muted">automatic</span>
              ),
          } satisfies Column<GoodsReceiptLineDto>,
        ]
      : []),
    ...(anySerial
      ? [
          {
            key: "serials",
            header: "Serial numbers",
            render: (l: GoodsReceiptLineDto) => (
              <>
                {l.serialNumbers.length ? <span className="mono">{l.serialNumbers.join(", ")}</span> : null}
                {l.rejectedSerialNumbers.length ? <p className="muted">Rejected: {l.rejectedSerialNumbers.join(", ")}</p> : null}
                {!l.serialNumbers.length && !l.rejectedSerialNumbers.length ? "—" : null}
              </>
            ),
          } satisfies Column<GoodsReceiptLineDto>,
        ]
      : []),
    ...(prices
      ? ([
          { key: "rate", header: "Rate", align: "right", render: (l) => rupees(l.rate) },
          { key: "gst", header: "GST %", align: "right", render: (l) => q(l.gstRate ?? "") },
          { key: "total", header: "Line total", align: "right", render: (l) => rupees(l.lineTotal) },
        ] satisfies Column<GoodsReceiptLineDto>[])
      : []),
    ...(costs
      ? ([
          { key: "extra", header: "Extra charges", align: "right", render: (l) => rupees(l.extraCharges) },
          { key: "cost", header: "Cost per basic unit", align: "right", render: (l) => (finalised ? (l.unitCost ?? "—") : "—") },
        ] satisfies Column<GoodsReceiptLineDto>[])
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          {title} <span className="mono">{r.number}</span>
        </h1>
        <ReceiptStatusBadge receipt={r} />
        <BackDatedBadge show={r.isBackDated} />
        <span className="spacer" />
        {r.status !== "draft" ? <LedgerEntryButton documentType="goods_receipt" documentId={r.id} /> : null}
      </div>

      {r.warnings && r.warnings.length > 0 ? (
        <Alert kind="info">
          <strong>Finalised with a warning: more was received than the order expected.</strong>
          <ul>
            {r.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {r.status === "cancelled" ? <Alert kind="info">{`Cancelled${r.cancelReason ? `: ${r.cancelReason}` : ""}. ${r.finalisedAt ? "Reversing stock entries were posted." : ""}`}</Alert> : null}
      {createdReturn ? (
        <Alert kind="success">
          Return <Link href={`/purchases/receipts/${createdReturn.id}`}>{createdReturn.number}</Link> was made; the goods have left stock.
        </Alert>
      ) : null}
      {r.billId ? (
        <Alert kind="info">
          These goods came in with a supplier bill. <Link href={`/purchases/bills/${r.billId}`}>Open the bill</Link> to change or cancel it.
        </Alert>
      ) : null}

      <div className="card">
        <dl className="kv">
          {r.isReturn && r.returnOfId ? (
            <>
              <dt>Return of</dt>
              <dd>
                <Link href={`/purchases/receipts/${r.returnOfId}`}>{original.data?.number ?? "the goods receipt"}</Link>
              </dd>
            </>
          ) : null}
          <dt>Supplier</dt>
          <dd>
            <span className="mono">{r.supplier.code}</span> — {r.supplier.name}
          </dd>
          <dt>Store</dt>
          <dd>
            {r.store.code} — {r.store.name}
          </dd>
          <dt>{r.isReturn ? "Date returned" : "Date received"}</dt>
          <dd>
            {formatDate(r.postingDate)} {indianTime(r.postingAt)}
          </dd>
          {r.deliveryNoteNo ? (
            <>
              <dt>Delivery note</dt>
              <dd>{r.deliveryNoteNo}</dd>
            </>
          ) : null}
          {r.transporterName || r.vehicleNo ? (
            <>
              <dt>Transport</dt>
              <dd>{[r.transporterName, r.vehicleNo].filter(Boolean).join(" · ")}</dd>
            </>
          ) : null}
          {r.noOrderReason ? (
            <>
              <dt>Without an order because</dt>
              <dd>{r.noOrderReason}</dd>
            </>
          ) : null}
          {!r.isReturn ? (
            <>
              <dt>Billed</dt>
              <dd>{q(r.billedPercent)}%</dd>
              <dt>Returned</dt>
              <dd>{q(r.returnedPercent)}%</dd>
            </>
          ) : null}
          {r.total !== undefined ? (
            <>
              <dt>Before GST</dt>
              <dd>{rupees(r.taxableAmount)}</dd>
              <dt>GST</dt>
              <dd>{rupees(r.taxAmount)}</dd>
              <dt>Total</dt>
              <dd>
                <strong>{rupees(r.total)}</strong>
              </dd>
            </>
          ) : null}
          {r.stockValue !== undefined && finalised ? (
            <>
              <dt>Stock value</dt>
              <dd>{rupees(r.stockValue)}</dd>
            </>
          ) : null}
          {r.finalisedAt ? (
            <>
              <dt>Finalised</dt>
              <dd>{formatDateTime(r.finalisedAt)}</dd>
            </>
          ) : null}
          {r.remarks ? (
            <>
              <dt>{r.isReturn ? "Reason" : "Remarks"}</dt>
              <dd>{r.remarks}</dd>
            </>
          ) : null}
        </dl>
      </div>

      <DataTable columns={columns} rows={r.lines} rowKey={(l) => l.id} empty="No lines." />

      {!r.isReturn && r.status !== "cancelled" ? <CheckPanel key={r.check?.checkedAt ?? "none"} receipt={r} canCheck={rights.receive} onChanged={onChanged} /> : null}

      <div className="actions">
        {canReturn ? (
          <Button variant="primary" onClick={() => setReturnOpen(true)}>
            Return goods
          </Button>
        ) : null}
        {canClose ? <Button onClick={() => setCloseOpen(true)}>Close (no more bills)</Button> : null}
        {canCancel ? (
          <Button variant="danger" onClick={() => setCancelOpen(true)}>
            {r.status === "draft" ? "Cancel draft" : r.isReturn ? "Cancel the return" : "Cancel the receipt"}
          </Button>
        ) : null}
        <Link href="/purchases/receipts" className="btn btn-secondary">
          Back to the list
        </Link>
      </div>

      {returnOpen ? (
        <ReceiptsReturnDialog
          receipt={r}
          onClose={() => setReturnOpen(false)}
          onReturned={(ret) => {
            setReturnOpen(false);
            setCreatedReturn(ret);
            void api.get<GoodsReceiptDto>(`/purchase/receipts/${r.id}`).then(onChanged, () => undefined);
          }}
        />
      ) : null}
      <ReasonDialog<GoodsReceiptDto>
        open={closeOpen}
        title={`Close ${r.number}`}
        explanation="Closing says no more supplier bills are expected for these goods. The goods stay in stock."
        path={`/purchase/receipts/${r.id}/close`}
        confirmLabel="Close the receipt"
        onClose={() => setCloseOpen(false)}
        onDone={onChanged}
      />
      <ReasonDialog<GoodsReceiptDto>
        open={cancelOpen}
        title={`Cancel ${r.number}`}
        explanation={
          r.status === "draft"
            ? "The draft is kept, marked as cancelled. Nothing in stock changes."
            : r.isReturn
              ? "Cancelling the return brings the goods back into stock at the same cost. The return stays visible, marked as cancelled."
              : "Cancelling takes the goods back out of stock and posts reversing entries. It is refused while a supplier bill, a return or extra charges refer to this receipt."
        }
        path={`/purchase/receipts/${r.id}/cancel`}
        confirmLabel={r.isReturn ? "Cancel the return" : "Cancel the receipt"}
        danger
        onClose={() => setCancelOpen(false)}
        onDone={onChanged}
      />
    </>
  );
}
