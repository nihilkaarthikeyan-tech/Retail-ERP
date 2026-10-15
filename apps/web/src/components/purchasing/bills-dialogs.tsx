// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState } from "react";
import { Decimal } from "shared";
import { Alert, Button, Dialog, TextareaInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { SupplierBillDto } from "@/lib/purchasing";
import { showQuantity, useBusinessToday } from "@/lib/stock";

function dec(v: string): Decimal | null {
  try {
    const d = new Decimal(v.trim());
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** Cancel a bill (draft or finalised) with a reason; the API's refusal is shown as it is. */
export function BillCancelDialog({ bill, open, onClose, onDone }: { bill: SupplierBillDto; open: boolean; onClose: () => void; onDone: (b: SupplierBillDto) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isNote = bill.kind === "debit_note";

  async function submit() {
    setError(null);
    if (!reason.trim()) {
      setError("Give a reason for cancelling.");
      return;
    }
    setBusy(true);
    try {
      onDone(await api.post<SupplierBillDto>(`/purchase/bills/${bill.id}/cancel`, { reason: reason.trim() }));
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={bill.status === "draft" ? "Cancel this draft" : isNote ? "Cancel this debit note" : "Cancel this bill"} onClose={onClose}>
      <p>
        {bill.status === "draft"
          ? "The draft will be kept but marked as cancelled."
          : bill.kind === "receives_goods"
            ? "The bill is reversed and the goods it brought in leave stock again."
            : "The bill is reversed. It stays on record, marked as cancelled."}
      </p>
      <TextareaInput id="bill-cancel-reason" label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
      <Alert kind="error">{error}</Alert>
      <div className="actions">
        <Button variant="danger" busy={busy} onClick={submit}>
          Cancel it
        </Button>
        <Button onClick={onClose}>Keep it</Button>
      </div>
    </Dialog>
  );
}

/** Hold a finalised bill until a future date (it is not paid while held). */
export function BillHoldDialog({ bill, open, onClose, onDone }: { bill: SupplierBillDto; open: boolean; onClose: () => void; onDone: (b: SupplierBillDto) => void }) {
  const today = useBusinessToday();
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!reason.trim()) return setError("Give a reason for holding the bill.");
    if (!until) return setError("Choose the date the hold ends.");
    if (today && until <= today) return setError("The hold must end on a future date.");
    setBusy(true);
    try {
      onDone(await api.post<SupplierBillDto>(`/purchase/bills/${bill.id}/hold`, { reason: reason.trim(), until }));
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title="Hold this bill" onClose={onClose}>
      <p>A held bill is not paid until the hold ends. It ends by itself on the date you choose, or you can release it sooner.</p>
      <TextareaInput id="bill-hold-reason" label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
      <TextInput id="bill-hold-until" label="Hold until" type="date" required min={today || undefined} value={until} onChange={(e) => setUntil(e.target.value)} />
      <Alert kind="error">{error}</Alert>
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={submit}>
          Hold
        </Button>
        <Button onClick={onClose}>Back</Button>
      </div>
    </Dialog>
  );
}

/** A debit note: part or all of a finalised bill goes back to the supplier. */
export function BillDebitNoteDialog({ bill, open, onClose, onDone }: { bill: SupplierBillDto; open: boolean; onClose: () => void; onDone: (note: SupplierBillDto) => void }) {
  const lines = bill.lines.map((l) => ({ line: l, left: Decimal.max(0, new Decimal(l.quantity).sub(l.returnedQuantity)) })).filter((x) => x.left.gt(0));
  const [qty, setQty] = useState<Record<string, string>>({});
  const [noteNo, setNoteNo] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const chosen: { originalLineId: string; quantity: string }[] = [];
    for (const { line, left } of lines) {
      const typed = (qty[line.id] ?? "").trim();
      if (!typed) continue;
      const d = dec(typed);
      if (!d || d.isNegative()) return setError(`${line.item.code}: type a quantity of zero or more`);
      if (d.gt(left)) return setError(`${line.item.code}: only ${left.toString()} left on the bill`);
      if (d.gt(0)) chosen.push({ originalLineId: line.id, quantity: d.toString() });
    }
    if (chosen.length === 0) return setError("Type the quantity going back on at least one line.");
    if (!reason.trim()) return setError("Give the reason for the debit note.");
    setBusy(true);
    try {
      const note = await api.post<SupplierBillDto>(`/purchase/bills/${bill.id}/debit-note`, { reason: reason.trim(), ...(noteNo.trim() ? { supplierNoteNo: noteNo.trim() } : {}), lines: chosen });
      onDone(note);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title="Make a debit note" onClose={onClose}>
      <p>A debit note reduces what we owe the supplier for this bill.</p>
      {bill.kind === "receives_goods" ? <Alert kind="info">This bill brought the goods in, so the goods also leave stock, at the cost they came in at.</Alert> : null}
      {lines.length === 0 ? (
        <p className="muted">Everything on this bill has already gone back.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">
                  Left on the bill
                </th>
                <th scope="col" className="num">
                  Quantity going back
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ line, left }) => (
                <tr key={line.id}>
                  <td>
                    <span className="mono">{line.item.code}</span> {line.item.name}
                  </td>
                  <td className="num">{showQuantity(left.toString())}</td>
                  <td className="num">
                    <input className="input" inputMode="decimal" aria-label={`Quantity going back for ${line.item.code}`} value={qty[line.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [line.id]: e.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TextInput id="dn-note-no" label="Supplier's credit note number (if any)" value={noteNo} onChange={(e) => setNoteNo(e.target.value)} />
      <TextareaInput id="dn-reason" label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
      <Alert kind="error">{error}</Alert>
      <div className="actions">
        <Button variant="primary" busy={busy} disabled={lines.length === 0} onClick={submit}>
          Make debit note
        </Button>
        <Button onClick={onClose}>Back</Button>
      </div>
    </Dialog>
  );
}

/** Plan 05 answer 4 ("warn"): the bill's prices differ from the receipts; record the difference only on purpose. */
export function PriceDifferenceDialog({ message, open, busy, onConfirm, onClose }: { message: string; open: boolean; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const text = message.replace(/^PRICE_DIFFERENCE:\s*/, "");
  return (
    <Dialog open={open} title="Prices differ from the goods received" onClose={onClose}>
      <p>{text.charAt(0).toUpperCase() + text.slice(1)}</p>
      <p className="muted">The stock keeps the cost it was received at; the difference is kept for the accounts.</p>
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={onConfirm}>
          Record the difference
        </Button>
        <Button onClick={onClose}>Not now</Button>
      </div>
    </Dialog>
  );
}

/** "until 20 Oct 2026" text for a held bill. */
export function heldText(bill: SupplierBillDto): string {
  return `Held until ${formatDate(bill.holdUntil)}${bill.holdReason ? `: ${bill.holdReason}` : ""}`;
}
