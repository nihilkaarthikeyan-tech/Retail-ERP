// Copyright (c) 2026, Rademics. All rights reserved.
// The billing screen (plan 06 §6 "Till"): scan or search, the bill lines with
// a number pad for quantity, price and discount, the customer, totals with the
// GST table, park / recall, return / exchange, cash in/out, pay and print.
// Every change is saved on the till at once (crash recovery, pos-offline §6).
// Figures come from the shared calculations, the same as the server's.
"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Decimal, hasPermission } from "shared";
import { Alert, Button } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { CreditApprovalError, type EngineState, PriceChangedError, type TillEngine } from "@/lib/till/engine";
import { qty, rupees } from "@/lib/till/format";
import { type ComputedLine, type DraftBill, type DraftLine, hasNamedCustomer, isDraftEmpty, type NeededApproval, priceBill, scan, searchItems } from "@/lib/till/pricing";
import { openDrawer, type PrintableReceipt, printWithHelper, withHeader } from "@/lib/till/receipt";
import type { Receipt, SnapItem, StoredSnapshot } from "@/lib/till/types";
import { BillOptionsDialog, CustomerDialog, HelperDialog, ParkedDialog } from "./bill-dialogs";
import { NumPad } from "./num-pad";
import { PayDialog } from "./pay-dialog";
import { type ApprovalRequest, ManagerApprovalDialog } from "./pin-dialogs";
import { PrintArea, ReceiptPaper } from "./receipt-paper";
import { ReturnDialog } from "./return-dialog";
import { CashDialog, CloseShiftDialog } from "./shift-dialogs";

type DialogName = "pay" | "customer" | "options" | "parked" | "return" | "cash" | "close" | "helper";
type PadMode = "qty" | "price" | "disc";

const PAD_LABEL: Record<PadMode, string> = { qty: "Quantity", price: "Price", disc: "Discount %" };

export const SHORTCUTS: [string, string][] = [
  ["F2", "Search"],
  ["F4", "Pay"],
  ["F6", "Customer"],
  ["F7", "Return"],
  ["F8", "Park"],
  ["F9", "Recall"],
  ["+ / −", "Quantity"],
  ["Del", "Remove line"],
  ["Esc", "Close / clear"],
];

interface Done {
  receipts: PrintableReceipt[];
  change: string;
  offline: boolean;
}

interface BillingScreenProps {
  engine: TillEngine;
  state: EngineState;
  snapshot: StoredSnapshot;
  cashierName: string;
}

export function BillingScreen({ engine, state, snapshot, cashierName }: BillingScreenProps) {
  const till = snapshot.till;
  const [draft, setDraft] = useState<DraftBill | null>(null);
  const [restored, setRestored] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [padMode, setPadMode] = useState<PadMode>("qty");
  const [padValue, setPadValue] = useState("");
  const [search, setSearch] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [approval, setApproval] = useState<{ request: ApprovalRequest; need: NeededApproval } | null>(null);
  /** An on-account bill over the credit limit waiting for a manager's PIN (plan 07 §1a). */
  const [creditApproval, setCreditApproval] = useState<ApprovalRequest | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [priceChanged, setPriceChanged] = useState<{ serverTotal: string; tillTotal: string } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [print, setPrint] = useState<{ receipts: PrintableReceipt[]; job: number }>({ receipts: [], job: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    engine.loadDraft().then(({ draft: d, restored: r }) => {
      if (cancelled) return;
      setDraft(d);
      setRestored(r);
    });
    return () => {
      cancelled = true;
    };
  }, [engine]);

  const today = engine.today();
  const bill = useMemo(() => (draft ? priceBill(draft, { snapshot, date: today }) : null), [draft, snapshot, today]);
  const results = useMemo(() => (search.trim().length >= 2 && !scan(snapshot, search) ? searchItems(snapshot, search, 12) : []), [snapshot, search]);
  const stock = useMemo(() => new Map(snapshot.stock.map((s) => [s.itemId, s.quantity])), [snapshot.stock]);
  const methods = till.paymentMethods.filter((m) => m.active);
  const canReturn = hasPermission(state.user, "pos.return");
  const shiftOld = !!state.shift && state.shift.businessDate !== today;
  const empty = !draft || isDraftEmpty(draft);
  const blocked = !bill || empty || bill.problems.length > 0 || bill.approvals.length > 0 || shiftOld;

  function change(next: DraftBill) {
    setDraft(next);
    void engine.saveDraft(next);
  }

  function patchLine(key: string, patch: Partial<DraftLine>) {
    if (!draft) return;
    change({ ...draft, payments: [], lines: draft.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  }

  function removeLine(key: string) {
    if (!draft) return;
    change({ ...draft, payments: [], lines: draft.lines.filter((l) => l.key !== key) });
    if (selected === key) setSelected(null);
  }

  function addItem(item: SnapItem, unitId: string, barcode: string | null) {
    if (!draft) return;
    setScanError(null);
    setNotice(null);
    const same = item.trackSerials ? undefined : draft.lines.find((l) => l.itemId === item.id && l.unitId === unitId && !l.priceOverride && (l.discountPercent || "0") === "0");
    if (same) {
      const next = new Decimal(same.quantity || "0").add(1).toString();
      patchLine(same.key, { quantity: next });
      setSelected(same.key);
    } else {
      const line: DraftLine = { key: engine.uuid(), itemId: item.id, unitId, quantity: "1", barcode, priceOverride: null, discountPercent: "0" };
      change({ ...draft, payments: [], lines: [...draft.lines, line] });
      setSelected(line.key);
    }
    setPadMode("qty");
    setPadValue("");
    setSearch("");
    searchRef.current?.focus();
  }

  function onScan(e?: FormEvent) {
    e?.preventDefault();
    const text = search.trim();
    if (!text) return;
    const hit = scan(snapshot, text);
    if (hit) return addItem(hit.item, hit.unitId, hit.barcode);
    const found = searchItems(snapshot, text, 12);
    if (found.length === 1) return addItem(found[0], found[0].baseUnitId, null);
    if (!found.length) setScanError(`Nothing found for "${text}"`);
  }

  function applyPad() {
    if (!draft || !selected) return;
    const line = draft.lines.find((l) => l.key === selected);
    if (!line) return;
    const v = padValue.trim();
    if (padMode === "qty") {
      if (!v) return;
      if (new Decimal(v).isZero()) removeLine(line.key);
      else patchLine(line.key, { quantity: v });
    } else if (padMode === "price") {
      patchLine(line.key, { priceOverride: v || null, approvalToken: undefined, approvedBy: undefined });
    } else {
      patchLine(line.key, { discountPercent: v || "0", approvalToken: undefined, approvedBy: undefined });
    }
    setPadValue("");
  }

  function stepQty(delta: number) {
    if (!draft || !selected) return;
    const line = draft.lines.find((l) => l.key === selected);
    if (!line) return;
    const next = new Decimal(line.quantity || "0").add(delta);
    if (next.lte(0)) removeLine(line.key);
    else patchLine(line.key, { quantity: next.toString() });
  }

  async function startNew() {
    const d = await engine.newDraft();
    setDraft(d);
    setSelected(null);
    setRestored(false);
    setPayError(null);
    setPriceChanged(null);
    setScanError(null);
  }

  async function park() {
    if (!draft || empty) return;
    const label = draft.customer?.name ?? `${draft.lines.length} item${draft.lines.length === 1 ? "" : "s"}, ${rupees(bill?.net ?? "0")}`;
    await engine.park(draft, label);
    await startNew();
    setNotice("Bill parked. Recall it with F9.");
  }

  async function recall(id: string) {
    if (!empty) {
      setNotice("Park or clear the current bill first.");
      setDialog(null);
      return;
    }
    const d = await engine.recall(id);
    if (d) {
      setDraft(d);
      setRestored(false);
    }
    setDialog(null);
  }

  async function printReceipts(receipts: PrintableReceipt[]) {
    if (!receipts.length) return;
    const ok = await printWithHelper(receipts);
    if (!ok) setPrint((p) => ({ receipts, job: p.job + 1 }));
  }

  function printable(receipts: Receipt[]): PrintableReceipt[] {
    return receipts.map((r) => withHeader(r, till, { cashier: cashierName, customer: draft?.customer?.name ?? null }));
  }

  async function finish(creditApprovalToken?: string) {
    if (!draft || !bill) return;
    setPayBusy(true);
    setPayError(null);
    try {
      // After a manager's approval the saved bill is sent again: same identity and numbers.
      const input = creditApprovalToken ? (await engine.loadDraft()).draft : draft;
      const res = await engine.finish(input, { creditApprovalToken });
      const receipts = printable(res.receipts);
      setDialog(null);
      setDone({ receipts, change: res.change, offline: res.offline });
      if (res.paidCash) void openDrawer();
      if (till.autoPrint) void printReceipts(receipts);
      const next = await engine.loadDraft();
      setDraft(next.draft);
      setSelected(null);
      setRestored(false);
    } catch (err) {
      if (err instanceof PriceChangedError) {
        setPriceChanged({ serverTotal: err.serverTotal, tillTotal: err.tillTotal });
        setDialog(null);
      } else if (err instanceof CreditApprovalError) {
        // Over the credit limit: a store manager's PIN, then the same bill is sent again.
        const customer = draft.customer?.name ?? snapshot.customers.find((c) => c.id === draft.ret?.customerId)?.name ?? "customer";
        setDialog(null);
        setCreditApproval({ action: "credit_over_limit", details: `${customer} on account ${rupees(bill.net)}`, reason: err.reason });
      } else {
        setPayError(errorMessage(err));
        setDialog("pay");
      }
      // The bill keeps the identity and numbers it was given (sent again as the same bill).
      const kept = await engine.loadDraft();
      setDraft(kept.draft);
    } finally {
      setPayBusy(false);
    }
  }

  async function reprint() {
    const last = await engine.lastReceipts();
    if (!last.length) return setNotice("No bill to print again yet.");
    const copies: Receipt[] = [];
    for (const r of last) {
      if (state.online && r.billId) {
        try {
          copies.push(await engine.api.reprint(r.billId));
          continue;
        } catch {
          // Offline or refused: print the till's own copy, marked duplicate.
        }
      }
      copies.push({ ...r, duplicate: true });
    }
    await printReceipts(copies.map((r) => withHeader(r, till, { cashier: cashierName })));
  }

  function askApproval(need: NeededApproval) {
    const line = need.lineKey ? draft?.lines.find((l) => l.key === need.lineKey) : null;
    const item = line ? snapshot.items.find((i) => i.id === line.itemId) : null;
    const details = need.kind === "bill_discount" ? `bill discount ${draft?.billDiscount?.amount ?? `${draft?.billDiscount?.percent}%`}` : `${item?.code ?? ""} ${need.kind === "price_change" ? `price ${line?.priceOverride}` : `${line?.discountPercent}%`}`;
    setApproval({ need, request: { action: need.kind, details, reason: need.reason } });
  }

  function approved(token: string, manager: { name: string }) {
    if (!approval || !draft) return;
    const need = approval.need;
    if (need.lineKey) patchLine(need.lineKey, { approvalToken: token, approvedBy: manager.name });
    else if (draft.billDiscount) change({ ...draft, billDiscount: { ...draft.billDiscount, approvalToken: token, approvedBy: manager.name } });
    setApproval(null);
  }

  // ---- Keyboard (listed on screen) ----
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      if (done && e.key === "Enter") {
        e.preventDefault();
        setDone(null);
        searchRef.current?.focus();
        return;
      }
      if (dialog || approval || creditApproval) return;
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      switch (e.key) {
        case "F2":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "F4":
          e.preventDefault();
          if (!blocked) setDialog("pay");
          break;
        case "F6":
          e.preventDefault();
          setDialog("customer");
          break;
        case "F7":
          e.preventDefault();
          if (canReturn) setDialog("return");
          break;
        case "F8":
          e.preventDefault();
          void park();
          break;
        case "F9":
          e.preventDefault();
          setDialog("parked");
          break;
        case "Escape":
          setDone(null);
          setSearch("");
          setScanError(null);
          break;
        case "Delete":
          if (!inField && selected) removeLine(selected);
          break;
        case "+":
          if (!inField) {
            e.preventDefault();
            stepQty(1);
          }
          break;
        case "-":
          if (!inField) {
            e.preventDefault();
            stepQty(-1);
          }
          break;
      }
    };
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (!draft || !bill) return <p className="till-center muted">Loading the bill…</p>;

  const saleLines = bill.sale?.lines ?? [];
  const retLines = bill.ret?.lines ?? [];
  const selectedLine = draft.lines.find((l) => l.key === selected) ?? null;
  const gstRows = [...(bill.ret ? [bill.ret] : []), ...(bill.sale ? [bill.sale] : [])].flatMap((p) => p.lines);
  const gstByRate = new Map<string, { taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal }>();
  for (const l of gstRows) {
    const k = l.gstRate.toString();
    const r = gstByRate.get(k) ?? { taxable: new Decimal(0), cgst: new Decimal(0), sgst: new Decimal(0), igst: new Decimal(0) };
    gstByRate.set(k, { taxable: r.taxable.add(l.tax.taxable), cgst: r.cgst.add(l.tax.cgst), sgst: r.sgst.add(l.tax.sgst), igst: r.igst.add(l.tax.igst) });
  }

  return (
    <>
      <div className="till-main">
        <section className="till-bill" aria-label="Bill">
          {restored ? (
            <div className="alert alert-info till-banner" role="status">
              <strong>Bill restored.</strong> The till was closed while this bill was being made; it is back as it was.
              <Button size="small" variant="link" onClick={() => setRestored(false)}>
                OK
              </Button>
            </div>
          ) : null}
          {shiftOld ? <Alert kind="error">This shift is from {state.shift?.businessDate}. Close it and open a new one before billing.</Alert> : null}
          {notice ? <Alert kind="info">{notice}</Alert> : null}
          {priceChanged ? (
            <div className="alert alert-error" role="alert">
              <strong>Prices changed.</strong> The server works this bill out at {rupees(priceChanged.serverTotal)}; the till showed {rupees(priceChanged.tillTotal)}.{" "}
              <Button
                size="small"
                variant="primary"
                onClick={async () => {
                  await engine.refresh();
                  setPriceChanged(null);
                  if (draft) change({ ...draft, payments: [] });
                }}
              >
                Update prices and check the bill
              </Button>
            </div>
          ) : null}

          <form className="till-scan" onSubmit={onScan} role="search">
            <label className="sr-only" htmlFor="till-scan">
              Scan a barcode or search by code or name
            </label>
            <input
              id="till-scan"
              ref={searchRef}
              className="input till-scan-input"
              placeholder="Scan barcode, or type code or name (F2)"
              autoComplete="off"
              autoFocus
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setScanError(null);
              }}
            />
            <Button type="submit" variant="primary" className="till-big">
              Add
            </Button>
          </form>
          {scanError ? <p className="field-error">{scanError}</p> : null}
          {results.length ? (
            <ul className="till-results" aria-label="Matching items">
              {results.map((i) => {
                const price = snapshot.prices.find((p) => p.itemId === i.id && !p.customerId);
                return (
                  <li key={i.id}>
                    <button type="button" className="till-list-button" onClick={() => addItem(i, i.baseUnitId, null)}>
                      <span>
                        {i.name} <span className="muted mono">{i.code}</span>
                      </span>
                      <span>
                        {price ? rupees(price.price) : ""}
                        {stock.has(i.id) ? <span className="muted"> · stock {qty(stock.get(i.id)!)}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="till-lines-wrap">
            <table className="table till-lines">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Price</th>
                  <th className="num">Discount</th>
                  <th className="num">Amount</th>
                  <th>
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {retLines.map((l) => (
                  <tr key={`r-${l.lineNo}`} className="till-line-return">
                    <td>
                      <span className="badge badge-warn">Return</span> {l.item.name}
                      {l.problem ? <div className="field-error">{l.problem}</div> : null}
                    </td>
                    <td className="num">{qty(l.quantity)}</td>
                    <td className="num">{rupees(l.price)}</td>
                    <td className="num">{rupees(l.discountAmount)}</td>
                    <td className="num">{rupees(l.amount)}</td>
                    <td>
                      <Button
                        variant="link"
                        aria-label={`Do not return ${l.item.name}`}
                        onClick={() => {
                          const lines = draft.ret!.lines.filter((x) => x.key !== l.draftKey);
                          change({ ...draft, payments: [], ret: lines.length ? { ...draft.ret!, lines } : null });
                        }}
                      >
                        ✕
                      </Button>
                    </td>
                  </tr>
                ))}
                {saleLines.map((l) => (
                  <LineRow
                    key={`s-${l.lineNo}`}
                    line={l}
                    draftLine={l.draftKey ? draft.lines.find((x) => x.key === l.draftKey) : undefined}
                    selected={l.draftKey !== null && l.draftKey === selected}
                    onSelect={() => l.draftKey && setSelected(l.draftKey)}
                    onRemove={() => l.draftKey && removeLine(l.draftKey)}
                    onSerials={(v) => l.draftKey && patchLine(l.draftKey, { serials: v })}
                  />
                ))}
                {!saleLines.length && !retLines.length ? (
                  <tr>
                    <td colSpan={6} className="muted till-empty">
                      Scan an item to start the bill.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {draft.ret ? (
            <p className="muted">
              Returning against bill <span className="mono">{draft.ret.originalNumber}</span>. Scan new items now for an exchange.
            </p>
          ) : null}
          {bill.approvals.length ? (
            <div className="till-approvals" role="region" aria-label="Needs a manager">
              {bill.approvals.map((a, i) => (
                <div key={i} className="till-approval">
                  <span>{a.reason}</span>
                  <Button variant="primary" onClick={() => askApproval(a)} disabled={!state.online}>
                    {state.online ? "Manager PIN" : "Needs the connection"}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          {bill.problems.length ? (
            <Alert kind="error">
              {bill.problems.map((p, i) => (
                <div key={i}>{p}</div>
              ))}
            </Alert>
          ) : null}
        </section>

        <aside className="till-side" aria-label="Customer, number pad and totals">
          <button type="button" className="till-customer" onClick={() => setDialog("customer")}>
            <span className="muted">Customer (F6)</span>
            <strong>{draft.customer ? draft.customer.name : "Walk-in customer"}</strong>
            {draft.customer?.mobile ? <span className="muted">{draft.customer.mobile}</span> : null}
          </button>

          <div className="till-pad-box">
            <div className="till-row" role="radiogroup" aria-label="Number pad changes">
              {(["qty", "price", "disc"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={padMode === m} className={`till-key till-mode${padMode === m ? " is-selected" : ""}`} onClick={() => setPadMode(m)} disabled={m === "price" && !selectedLine}>
                  {PAD_LABEL[m]}
                </button>
              ))}
            </div>
            <div className="till-pad-display" aria-live="polite">
              {selectedLine ? `${PAD_LABEL[padMode]}: ${padValue || "…"}` : "Select a line to change it"}
            </div>
            <NumPad value={padValue} onChange={setPadValue} onEnter={applyPad} enterLabel="Set" label={`${PAD_LABEL[padMode]} pad`} />
          </div>

          <div className="till-totals">
            <dl>
              {bill.sale ? (
                <>
                  <dt>Items</dt>
                  <dd>{rupees(bill.sale.gross)}</dd>
                  {bill.sale.discount.gt(0) ? (
                    <>
                      <dt>Discount{bill.billOffer ? ` (${bill.billOffer.name})` : ""}</dt>
                      <dd>−{rupees(bill.sale.discount)}</dd>
                    </>
                  ) : null}
                </>
              ) : null}
              {bill.ret ? (
                <>
                  <dt>Coming back</dt>
                  <dd>{rupees(bill.ret.total)}</dd>
                </>
              ) : null}
              {bill.sale && !bill.sale.rounding.isZero() ? (
                <>
                  <dt>Rounding</dt>
                  <dd>{rupees(bill.sale.rounding)}</dd>
                </>
              ) : null}
            </dl>
            <div className="till-total">
              <span>{bill.net.isNegative() ? "Refund" : "Total"}</span>
              <strong data-testid="bill-total">{rupees(bill.net.abs())}</strong>
            </div>
            {gstByRate.size ? (
              <table className="table till-gst">
                <caption>GST{bill.provisional ? " (provisional)" : ""}</caption>
                <thead>
                  <tr>
                    <th>Rate</th>
                    <th className="num">Taxable</th>
                    {bill.interState ? <th className="num">IGST</th> : (
                      <>
                        <th className="num">CGST</th>
                        <th className="num">SGST</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[...gstByRate.entries()].map(([rate, r]) => (
                    <tr key={rate}>
                      <td>{rate}%</td>
                      <td className="num">{rupees(r.taxable)}</td>
                      {bill.interState ? <td className="num">{rupees(r.igst)}</td> : (
                        <>
                          <td className="num">{rupees(r.cgst)}</td>
                          <td className="num">{rupees(r.sgst)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>

          <div className="till-actions">
            <button type="button" className="till-action till-action-pay" disabled={blocked} onClick={() => setDialog("pay")}>
              {bill.net.isNegative() ? "Refund" : "Pay"} <kbd>F4</kbd>
            </button>
            <button type="button" className="till-action" disabled={empty} onClick={() => void park()}>
              Park <kbd>F8</kbd>
            </button>
            <button type="button" className="till-action" onClick={() => setDialog("parked")}>
              Recall <kbd>F9</kbd>
            </button>
            <button type="button" className="till-action" disabled={!canReturn || !!draft.ret} onClick={() => setDialog("return")}>
              Return / exchange <kbd>F7</kbd>
            </button>
            <button type="button" className="till-action" onClick={() => setDialog("options")} disabled={!draft.lines.length}>
              Coupon / bill discount
            </button>
            <button type="button" className="till-action" onClick={() => setDialog("cash")}>
              Cash in / out
            </button>
            <button type="button" className="till-action" onClick={() => void reprint()}>
              Print last again
            </button>
            <button
              type="button"
              className={`till-action${clearArmed ? " till-action-danger" : ""}`}
              disabled={empty}
              onClick={() => {
                if (!clearArmed) {
                  setClearArmed(true);
                  setTimeout(() => setClearArmed(false), 3000);
                  return;
                }
                setClearArmed(false);
                void startNew();
              }}
            >
              {clearArmed ? "Tap again to clear" : "Clear bill"}
            </button>
            <button type="button" className="till-action" onClick={() => setDialog("close")}>
              Close shift
            </button>
            <button type="button" className="till-action" onClick={() => setDialog("helper")}>
              Printer
            </button>
          </div>
        </aside>
      </div>

      <footer className="till-keys" aria-label="Keyboard shortcuts">
        {SHORTCUTS.map(([k, label]) => (
          <span key={k}>
            <kbd>{k}</kbd> {label}
          </span>
        ))}
      </footer>

      {done ? (
        <div className="till-done" role="dialog" aria-modal="true" aria-labelledby="till-done-title">
          <div className="till-done-box">
            <h2 id="till-done-title">Bill finished</h2>
            {done.offline ? <Alert kind="info">Saved on the till; it will be sent when the connection returns.</Alert> : null}
            <div className="till-change till-change-huge">
              <span>Change</span>
              <strong data-testid="done-change">{rupees(done.change)}</strong>
            </div>
            <div className="till-done-receipts">
              {done.receipts.map((r) => (
                <ReceiptPaper key={r.number} receipt={r} />
              ))}
            </div>
            <div className="actions">
              <Button onClick={() => void printReceipts(done.receipts)}>Print</Button>
              <Button
                variant="primary"
                className="till-big"
                autoFocus
                onClick={() => {
                  setDone(null);
                  searchRef.current?.focus();
                }}
              >
                New bill (Enter)
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <PayDialog
        open={dialog === "pay"}
        net={bill.net}
        draft={draft}
        methods={methods}
        busy={payBusy}
        error={payError}
        online={state.online && !state.signedOut}
        namedCustomer={hasNamedCustomer(draft, till.walkInCustomerId)}
        refundOnAccount={!!draft.ret?.paidOnAccount}
        onChange={(payments) => change({ ...draft, payments })}
        onFinish={() => void finish()}
        onClose={() => setDialog(null)}
      />
      <CustomerDialog
        open={dialog === "customer"}
        snapshot={snapshot}
        current={draft.customer}
        newId={engine.uuid}
        onPick={(c) => {
          change({ ...draft, customer: c, payments: [] });
          setDialog(null);
        }}
        onClose={() => setDialog(null)}
      />
      {dialog === "options" ? (
        <BillOptionsDialog
          open
          draft={draft}
          onSave={(p) => {
            change({ ...draft, ...p, payments: [] });
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      <ParkedDialog open={dialog === "parked"} engine={engine} onRecall={(id) => void recall(id)} onClose={() => setDialog(null)} />
      <ReturnDialog
        open={dialog === "return"}
        engine={engine}
        onClose={() => setDialog(null)}
        onChosen={(ret) => {
          const known = snapshot.customers.find((c) => c.id === ret.customerId);
          const customer = known && known.id !== till.walkInCustomerId ? { id: known.id, name: known.name, mobile: known.mobile, gstin: known.gstin, stateCode: known.stateCode, customerGroupId: known.customerGroupId } : null;
          change({ ...draft, ret, customer, payments: [] });
          setDialog(null);
        }}
      />
      <CashDialog open={dialog === "cash"} engine={engine} onClose={() => setDialog(null)} />
      <CloseShiftDialog
        open={dialog === "close"}
        engine={engine}
        online={state.online}
        onClose={() => setDialog(null)}
        onClosed={() => {
          setDialog(null);
        }}
      />
      {dialog === "helper" ? <HelperDialog open onClose={() => setDialog(null)} /> : null}
      <ManagerApprovalDialog api={engine.api} online={state.online} request={approval?.request ?? null} onApproved={approved} onClose={() => setApproval(null)} />
      <ManagerApprovalDialog
        api={engine.api}
        online={state.online}
        request={creditApproval}
        onApproved={(token) => {
          setCreditApproval(null);
          void finish(token);
        }}
        onClose={() => {
          setPayError(creditApproval ? `${creditApproval.reason}. Not approved; take another payment method.` : null);
          setCreditApproval(null);
          setDialog("pay");
        }}
      />
      <PrintArea receipts={print.receipts} job={print.job} />
    </>
  );
}

function LineRow({ line, draftLine, selected, onSelect, onRemove, onSerials }: { line: ComputedLine; draftLine?: DraftLine; selected: boolean; onSelect: () => void; onRemove: () => void; onSerials: (v: string) => void }) {
  const overridden = !line.isFree && !line.price.eq(line.listPrice);
  return (
    <tr className={`${selected ? "till-line-selected" : ""}${line.problem ? " row-alert" : ""}`} onClick={onSelect} aria-selected={selected}>
      <td>
        {line.isFree ? <span className="badge badge-ok">Free</span> : null} {line.item.name}
        <div className="muted till-line-sub">
          {line.item.code}
          {line.unitCode ? ` · ${line.unitCode}` : ""}
          {line.offer && !line.isFree ? ` · ${line.offer.name}` : ""}
          {draftLine?.approvedBy ? ` · approved by ${draftLine.approvedBy}` : ""}
        </div>
        {line.item.trackSerials && !line.isFree ? (
          <input
            className="input till-input-small"
            aria-label={`Serial numbers of ${line.item.name}`}
            placeholder="Serial numbers"
            value={draftLine?.serials ?? ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onSerials(e.target.value)}
          />
        ) : null}
        {line.problem ? <div className="field-error">{line.problem}</div> : null}
      </td>
      <td className="num">{qty(line.quantity)}</td>
      <td className="num">
        {overridden ? <s className="muted">{rupees(line.listPrice)}</s> : null} {rupees(line.price)}
      </td>
      <td className="num">{line.discountAmount.gt(0) ? `−${rupees(line.discountAmount)}` : ""}</td>
      <td className="num">{rupees(line.amount)}</td>
      <td>
        {!line.isFree ? (
          <Button
            variant="link"
            aria-label={`Remove ${line.item.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            ✕
          </Button>
        ) : null}
      </td>
    </tr>
  );
}
