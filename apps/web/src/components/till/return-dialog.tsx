// Copyright (c) 2026, Rademics. All rights reserved.
// Returns and exchanges at the till (blueprint 09 processes 4–5; decision 42).
// The original bill is found on the server by its number (any till) or, when
// offline, among this till's own recent bills. The cashier picks the lines and
// quantities; new items added afterwards make it an exchange, netted on one
// payment. Refunds go back only by refund methods (pay screen); a bill paid
// on account may be refunded on account for its named customer (plan 07 §1a).
// Without the original bill (plan 11 A9) the cashier scans what comes back;
// it is priced from the till's list, needs a manager's PIN and the connection.
"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Decimal } from "shared";
import { Alert, Button, Dialog } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import type { RecentBill, TillEngine } from "@/lib/till/engine";
import { qty, rupees } from "@/lib/till/format";
import { type DraftBill, type DraftReturnLine, listPriceFor, scan, searchItems } from "@/lib/till/pricing";
import type { BillDto, SnapItem, StoredSnapshot } from "@/lib/till/types";

export const NO_BILL_OFFLINE_HINT = "Returns without a bill need the connection: a manager approves them on the server. Try again when the till is online.";

/** An item coming back without a bill, as typed in the dialog. */
interface NoBillRow {
  key: string;
  item: SnapItem;
  unitId: string;
  quantity: string;
  /** What the customer paid, if the cashier types it; blank = the list price. */
  price: string;
}

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
  snapshot: StoredSnapshot;
  /** The till can reach the server (a return without a bill needs it). */
  online: boolean;
  onClose: () => void;
  /** The original bill, or null for a return without a bill. */
  onChosen: (ret: NonNullable<DraftBill["ret"]>, bill: BillDto | null) => void;
}

export function ReturnDialog({ open, engine, snapshot, online, onClose, onChosen }: ReturnDialogProps) {
  const [number, setNumber] = useState("");
  const [bill, setBill] = useState<BillDto | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<RecentBill[]>([]);
  const [noBill, setNoBill] = useState(false);
  const [rows, setRows] = useState<NoBillRow[]>([]);
  const [search, setSearch] = useState("");
  const today = engine.today();
  const results = useMemo(() => (noBill && search.trim().length >= 2 && !scan(snapshot, search) ? searchItems(snapshot, search, 8) : []), [noBill, snapshot, search]);

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
    const paidOnAccount = bill.payments.some((p) => p.paymentMethod.kind === "on_account");
    onChosen({ originalBillId: bill.id, originalNumber: bill.number, customerId: bill.customerId, lines, reason: reason.trim() || null, paidOnAccount }, bill);
    setBill(null);
    setNumber("");
    setCounts({});
    setReason("");
  }

  // ---- Without the original bill ----

  function addBack(item: SnapItem, unitId: string) {
    setError(null);
    setSearch("");
    // The server cannot tell which batch or serial came back without the bill.
    if (item.isStockItem && (item.trackSerials || item.trackBatches)) {
      return setError(`${item.name} is tracked by ${item.trackSerials ? "serial number" : "batch"}; return it against its bill`);
    }
    const same = rows.find((r) => r.item.id === item.id && r.unitId === unitId);
    if (same) return setRows(rows.map((r) => (r.key === same.key ? { ...r, quantity: new Decimal(r.quantity || "0").add(1).toString() } : r)));
    setRows([...rows, { key: engine.uuid(), item, unitId, quantity: "1", price: "" }]);
  }

  function onScanBack(e?: FormEvent) {
    e?.preventDefault();
    const text = search.trim();
    if (!text) return;
    const hit = scan(snapshot, text);
    if (hit) return addBack(hit.item, hit.unitId);
    const found = searchItems(snapshot, text, 8);
    if (found.length === 1) return addBack(found[0], found[0].baseUnitId);
    if (!found.length) setError(`Nothing found for "${text}"`);
  }

  function confirmNoBill() {
    if (!online) return setError(NO_BILL_OFFLINE_HINT);
    if (!rows.length) return setError("Scan or search what comes back");
    const lines: DraftReturnLine[] = [];
    for (const r of rows) {
      let q: Decimal;
      try {
        q = new Decimal(r.quantity || "0");
      } catch {
        return setError(`${r.item.name}: the quantity is not a number`);
      }
      if (q.lte(0)) return setError(`${r.item.name}: the quantity must be above zero`);
      if (r.price.trim()) {
        try {
          if (new Decimal(r.price).isNegative()) return setError(`${r.item.name}: the price cannot be below zero`);
        } catch {
          return setError(`${r.item.name}: the price is not a number`);
        }
      }
      lines.push({ key: r.key, originalLineId: null, itemId: r.item.id, unitId: r.unitId, code: r.item.code, name: r.item.name, quantity: q.toString(), priceOverride: r.price.trim() || null });
    }
    onChosen({ originalBillId: null, originalNumber: null, customerId: null, lines, reason: reason.trim() || null, paidOnAccount: false }, null);
    setNoBill(false);
    setRows([]);
    setSearch("");
    setReason("");
    setError(null);
  }

  if (noBill) {
    return (
      <Dialog open={open} title="Return without a bill" onClose={onClose}>
        <p className="till-dialog-lead">Scan or search each item coming back. A manager approves the return with their PIN; the refund goes back only by methods allowed for refunds.</p>
        {!online ? <Alert kind="error">{NO_BILL_OFFLINE_HINT}</Alert> : null}
        <form onSubmit={onScanBack} className="till-row">
          <label className="sr-only" htmlFor="till-return-scan">
            Scan or search the item coming back
          </label>
          <input id="till-return-scan" className="input till-input-big" placeholder="Scan barcode, or type code or name" autoComplete="off" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          <Button type="submit" variant="primary">
            Add
          </Button>
        </form>
        {results.length ? (
          <ul className="till-list" aria-label="Matching items">
            {results.map((i) => (
              <li key={i.id}>
                <button type="button" className="till-list-button" onClick={() => addBack(i, i.baseUnitId)}>
                  <span>
                    {i.name} <span className="muted mono">{i.code}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {rows.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">List price</th>
                <th className="num">Coming back</th>
                <th className="num">Price paid (if known)</th>
                <th>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const list = listPriceFor(snapshot, r.item, r.unitId, "1", null, today);
                return (
                  <tr key={r.key}>
                    <td>
                      {r.item.name} <span className="muted mono">{r.item.code}</span>
                    </td>
                    <td className="num">{list ? rupees(list) : "No price"}</td>
                    <td className="num">
                      <input
                        className="input till-input-small"
                        inputMode="decimal"
                        aria-label={`Quantity of ${r.item.name} coming back`}
                        value={r.quantity}
                        onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, quantity: e.target.value.replace(/[^\d.]/g, "") } : x)))}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="input till-input-small"
                        inputMode="decimal"
                        aria-label={`Price paid for ${r.item.name}`}
                        placeholder={list ? list.toFixed(2) : ""}
                        value={r.price}
                        onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, price: e.target.value.replace(/[^\d.]/g, "") } : x)))}
                      />
                    </td>
                    <td>
                      <Button variant="link" aria-label={`Do not return ${r.item.name}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                        ✕
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
        <label className="till-pin-label" htmlFor="till-return-reason">
          Reason (optional)
        </label>
        <input id="till-return-reason" className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Alert kind="error">{error}</Alert>
        <div className="actions">
          <Button variant="primary" className="till-big" onClick={confirmNoBill} disabled={!online || !rows.length}>
            Return these (manager PIN next)
          </Button>
          <Button
            onClick={() => {
              setNoBill(false);
              setError(null);
            }}
          >
            Find a bill instead
          </Button>
        </div>
        <p className="muted">After this, scan new items for an exchange; the customer pays or gets back only the difference.</p>
      </Dialog>
    );
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
          <div className="till-row">
            <Button
              disabled={!online}
              onClick={() => {
                setNoBill(true);
                setError(null);
              }}
            >
              Return without a bill
            </Button>
          </div>
          <p className="muted">{online ? "No bill? The items are priced from the till's price list and a manager approves the return with their PIN." : NO_BILL_OFFLINE_HINT}</p>
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
