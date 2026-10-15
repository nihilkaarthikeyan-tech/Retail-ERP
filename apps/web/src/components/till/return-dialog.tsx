// Copyright (c) 2026, Rademics. All rights reserved.
// Returns and exchanges at the till (blueprint 09 processes 4–5; decision 42).
// The original bill is found on the server by its number (any till) or, when
// offline, among this till's own recent bills. The cashier picks the lines and
// quantities; new items added afterwards make it an exchange, netted on one
// payment. Refunds go back only by refund methods (pay screen).
"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Decimal } from "shared";
import { Alert, Button, Dialog } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import type { RecentBill, TillEngine } from "@/lib/till/engine";
import { qty, rupees } from "@/lib/till/format";
import type { DraftBill, DraftReturnLine } from "@/lib/till/pricing";
import type { BillDto } from "@/lib/till/types";

/** Quantity still returnable on a line, in the line's own unit. */
export function leftToReturn(l: BillDto["lines"][number]): Decimal {
  const basic = new Decimal(l.basicQuantity);
  if (basic.isZero()) return new Decimal(0);
  const left = basic.sub(new Decimal(l.returnedQuantity)).mul(new Decimal(l.quantity)).div(basic);
  return left.isNegative() ? new Decimal(0) : left.toDecimalPlaces(3);
}

interface ReturnDialogProps {
  open: boolean;
  engine: TillEngine;
  onClose: () => void;
  onChosen: (ret: NonNullable<DraftBill["ret"]>, bill: BillDto) => void;
}

export function ReturnDialog({ open, engine, onClose, onChosen }: ReturnDialogProps) {
  const [number, setNumber] = useState("");
  const [bill, setBill] = useState<BillDto | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<RecentBill[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    engine.recentBills().then((r) => {
      if (!cancelled) setRecent(r.filter((x) => x.bill?.kind === "sale").slice(0, 8));
    });
    return () => {
      cancelled = true;
    };
  }, [engine, open]);

  function choose(b: BillDto) {
    if (b.kind !== "sale") return setError(`${b.number} is not a sale`);
    if (b.status !== "completed") return setError(`Bill ${b.number} is cancelled`);
    setBill(b);
    setCounts({});
    setError(null);
  }

  async function find(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      choose(await engine.findBillForReturn(number));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (!bill) return;
    const lines: DraftReturnLine[] = [];
    for (const l of bill.lines) {
      const raw = counts[l.id];
      if (!raw) continue;
      let q: Decimal;
      try {
        q = new Decimal(raw);
      } catch {
        return setError(`${l.item.name}: the quantity is not a number`);
      }
      if (q.lte(0)) continue;
      const left = leftToReturn(l);
      if (q.gt(left)) return setError(`${l.item.name}: only ${qty(left)} left to return on bill ${bill.number}`);
      lines.push({
        key: l.id,
        originalLineId: l.id,
        itemId: l.item.id,
        unitId: l.unitId,
        code: l.item.code,
        name: l.item.name,
        quantity: q.toString(),
        maxQuantity: left.toString(),
        originalQuantity: l.quantity,
        originalPrice: l.price,
        originalDiscount: l.discountAmount,
        originalLineTotal: l.lineTotal,
        gstRate: l.gstRate,
        isFree: l.isFree,
      });
    }
    if (!lines.length) return setError("Choose what comes back");
    onChosen({ originalBillId: bill.id, originalNumber: bill.number, customerId: bill.customerId, lines, reason: reason.trim() || null }, bill);
    setBill(null);
    setNumber("");
    setCounts({});
    setReason("");
  }

  return (
    <Dialog open={open} title="Return or exchange" onClose={onClose}>
      {!bill ? (
        <>
          <form onSubmit={find} className="till-row">
            <label className="sr-only" htmlFor="till-return-number">
              Bill number
            </label>
            <input id="till-return-number" className="input till-input-big" placeholder="Scan or type the bill number" value={number} onChange={(e) => setNumber(e.target.value)} autoFocus />
            <Button type="submit" variant="primary" busy={busy}>
              Find
            </Button>
          </form>
          <Alert kind="error">{error}</Alert>
          {recent.length ? (
            <>
              <h3>Recent bills on this till</h3>
              <ul className="till-list">
                {recent.map((r) => (
                  <li key={r.number}>
                    <button type="button" className="till-list-button" onClick={() => r.bill && choose(r.bill)}>
                      <span className="mono">{r.number}</span>
                      <span>{rupees(r.bill?.total)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="muted">Returns without a bill need a manager and are done from the back office.</p>
        </>
      ) : (
        <>
          <p className="till-dialog-lead">
            Bill <span className="mono">{bill.number}</span> · {rupees(bill.total)}
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Sold</th>
                <th className="num">Left</th>
                <th className="num">Amount paid</th>
                <th className="num">Coming back</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((l) => {
                const left = leftToReturn(l);
                return (
                  <tr key={l.id}>
                    <td>
                      {l.item.name}
                      {l.isFree ? " (free)" : ""}
                    </td>
                    <td className="num">{qty(l.quantity)}</td>
                    <td className="num">{qty(left)}</td>
                    <td className="num">{rupees(l.lineTotal)}</td>
                    <td className="num">
                      <div className="till-row">
                        <input
                          className="input till-input-small"
                          inputMode="decimal"
                          aria-label={`Quantity of ${l.item.name} coming back`}
                          value={counts[l.id] ?? ""}
                          disabled={left.lte(0)}
                          onChange={(e) => setCounts({ ...counts, [l.id]: e.target.value.replace(/[^\d.]/g, "") })}
                        />
                        <Button size="small" disabled={left.lte(0)} onClick={() => setCounts({ ...counts, [l.id]: left.toString() })}>
                          All
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <label className="till-pin-label" htmlFor="till-return-reason">
            Reason (optional)
          </label>
          <input id="till-return-reason" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Alert kind="error">{error}</Alert>
          <div className="actions">
            <Button variant="primary" className="till-big" onClick={confirm}>
              Return these
            </Button>
            <Button onClick={() => setBill(null)}>Another bill</Button>
          </div>
          <p className="muted">After this, scan new items for an exchange; the customer pays or gets back only the difference.</p>
        </>
      )}
    </Dialog>
  );
}
