// Copyright (c) 2026, Rademics. All rights reserved.
// Paying a bill (blueprint 09 process 3; plan 06 §6 "Pay"): cash, card and UPI
// split from the till's own methods, references for methods that need them,
// change shown big. Refunds only by methods allowed for refunds. The payments
// are part of the saved bill, so they survive a crash too. On account (the
// customer pays later, plan 07 §1a) needs a named customer and the connection.
// Plan 13: points and gift cards pay part of a sale (online only).
"use client";

import { type KeyboardEvent, useRef, useState } from "react";
import { Decimal } from "shared";
import { Alert, Button, Dialog } from "@/components/ui";
import { rupees } from "@/lib/till/format";
import { checkPayments, type DraftBill, type DraftGiftCard, type DraftPayment, usesOnAccount } from "@/lib/till/pricing";
import type { SnapLoyalty, SnapPaymentMethod, TillCustomerPoints, TillGiftCard } from "@/lib/till/types";
import { PointsAndCards } from "./points-cards";

const QUICK_CASH = ["100", "200", "500", "2000"];

interface PayDialogProps {
  open: boolean;
  net: Decimal;
  draft: DraftBill;
  methods: SnapPaymentMethod[];
  busy: boolean;
  error: string | null;
  /** The till can reach the server (on account needs it). */
  online?: boolean;
  /** The bill is for a named customer, not walk-in (on account needs one). */
  namedCustomer?: boolean;
  /** A refund may go back on account (the original bill was paid on account). */
  refundOnAccount?: boolean;
  /** Plan 12: "Credit sales" is on, so a sale may be put on account. Refunds on account stay possible. */
  creditSales?: boolean;
  onChange: (payments: DraftPayment[]) => void;
  onFinish: () => void;
  onClose: () => void;
  /** Plan 13: points and gift cards (sales only; online only). Left out, the part is not shown. */
  special?: {
    loyalty: SnapLoyalty | null;
    giftCardsOn: boolean;
    customerPoints: TillCustomerPoints | null;
    /** The sale's total, for the share of points. */
    billTotal: Decimal;
    onPoints: (p: DraftBill["points"]) => void;
    onGiftCards: (cards: DraftGiftCard[]) => void;
    checkCard: (number: string) => Promise<TillGiftCard>;
  };
}

function sum(rows: DraftPayment[]): Decimal {
  return rows.reduce((s, p) => {
    try {
      return s.add(new Decimal(p.amount || "0"));
    } catch {
      return s;
    }
  }, new Decimal(0));
}

export const ON_ACCOUNT_WALK_IN = "On account is only for a named customer. Close this and choose the customer with F6 Customer.";

/** Change this large is almost always a slip (or a barcode scanned into the amount box). */
export const CHANGE_CHECK_FROM = new Decimal(10000);
/** Keys closer together than this are a barcode scanner, not a person. */
export const SCAN_GAP_MS = 50;
/** How many fast keys in a row count as a scan. */
const SCAN_KEYS = 4;
/** When a key came (read in the key handler only). */
const keyTime = () => Date.now();
export const SCANNED_INTO_AMOUNT = "That looked like a barcode scanned into the amount, so it was taken out. Type the amount received.";

/** An amount as typed: digits and one point, at most 9 digits before the point and 2 after. */
export function cleanAmount(text: string): string {
  const s = text.replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  const whole = (dot < 0 ? s : s.slice(0, dot)).slice(0, 9);
  return dot < 0 ? whole : `${whole}.${s.slice(dot + 1).replace(/\./g, "").slice(0, 2)}`;
}

export function PayDialog({ open, net, draft, methods, busy, error, online = true, namedCustomer = false, refundOnAccount = false, creditSales = true, onChange, onFinish, onClose, special }: PayDialogProps) {
  const refund = net.isNegative();
  const due = net.abs();
  const usable = methods.filter((m) => m.active && (!refund || m.allowRefund) && (m.kind !== "on_account" || (refund ? refundOnAccount && namedCustomer : creditSales)));
  const rows = draft.payments;
  const check = checkPayments(net, rows, methods);
  const [notice, setNotice] = useState<string | null>(null);
  const onAccountUsed = usesOnAccount(rows, methods);
  const onAccountProblem = !onAccountUsed ? null : !namedCustomer ? ON_ACCOUNT_WALK_IN : !online ? "On account needs the connection. Take another payment method, or wait until the till is online." : null;
  const cash = usable.find((m) => m.kind === "cash" && m.isDefault) ?? usable.find((m) => m.kind === "cash");
  const bigChange = !refund && check.change.gte(CHANGE_CHECK_FROM) ? `Check the amount: change of ${rupees(check.change)}` : null;
  /** Fast keys in an amount box (a scanner): which row, its amount before them, when the last came, how many. */
  const burst = useRef<{ row: number; before: string; last: number; count: number } | null>(null);

  function amountKey(e: KeyboardEvent<HTMLInputElement>, row: number, value: string) {
    const now = keyTime();
    const b = burst.current;
    const fast = !!b && b.row === row && now - b.last < SCAN_GAP_MS;
    if (e.key === "Enter") {
      // The Enter a scanner sends after the code: do not finish the bill on it, and take the code out again.
      if (fast && b.count >= SCAN_KEYS) {
        e.preventDefault();
        setRow(row, { amount: b.before });
        setNotice(SCANNED_INTO_AMOUNT);
      }
      burst.current = null;
      return;
    }
    if (e.key.length !== 1) return;
    burst.current = fast ? { ...b, last: now, count: b.count + 1 } : { row, before: value, last: now, count: 1 };
  }

  function remainingFor(index: number): Decimal {
    const others = sum(rows.filter((_, i) => i !== index));
    const left = due.sub(others);
    return left.isNegative() ? new Decimal(0) : left;
  }

  function setRow(index: number, patch: Partial<DraftPayment>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addMethod(m: SnapPaymentMethod, amount?: string) {
    setNotice(null);
    if (m.kind === "on_account" && !namedCustomer) {
      setNotice(ON_ACCOUNT_WALK_IN);
      return;
    }
    const at = rows.findIndex((r) => r.methodId === m.id);
    if (at >= 0) {
      setRow(at, { amount: amount ?? remainingFor(at).toFixed(2) });
      return;
    }
    const left = due.sub(sum(rows));
    onChange([...rows, { methodId: m.id, amount: amount ?? (left.isNegative() ? "0" : left.toFixed(2)), reference: "" }]);
  }

  function quickCash(amount: string) {
    if (!cash) return;
    const at = rows.findIndex((r) => r.methodId === cash.id);
    if (at >= 0) setRow(at, { amount });
    else addMethod(cash, amount);
  }

  const ready = !check.problem && !onAccountProblem && !bigChange && check.short.isZero() && (rows.length > 0 || net.isZero());
  return (
    <Dialog
      open={open}
      title={refund ? "Refund" : "Payment"}
      onClose={() => {
        setNotice(null);
        onClose();
      }}
    >
      <form
        className="till-pay"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) onFinish();
        }}
      >
        <div className="till-pay-due">
          <span>{refund ? "To refund" : "To pay"}</span>
          <strong data-testid="pay-due">{rupees(due)}</strong>
        </div>
        {special && !refund ? (
          <PointsAndCards
            loyalty={special.loyalty}
            giftCardsOn={special.giftCardsOn}
            online={online}
            namedCustomer={namedCustomer}
            customerPoints={special.customerPoints}
            billTotal={special.billTotal}
            due={due}
            points={draft.points ?? null}
            giftCards={draft.giftCards ?? []}
            onPoints={special.onPoints}
            onGiftCards={special.onGiftCards}
            checkCard={special.checkCard}
          />
        ) : null}
        <div className="till-pay-methods" role="group" aria-label="Payment methods">
          {usable.map((m) => {
            const offline = m.kind === "on_account" && !online;
            return (
              <button key={m.id} type="button" className="till-key till-method" disabled={offline} title={offline ? "Needs the connection" : undefined} onClick={() => addMethod(m)}>
                {m.name}
                {offline ? " (needs the connection)" : ""}
              </button>
            );
          })}
        </div>
        {notice ? <Alert kind="info">{notice}</Alert> : null}
        {refund ? <p className="muted">Only methods allowed for refunds are shown. The refund must be exactly the amount above.</p> : null}
        {rows.length ? (
          <table className="table till-pay-rows">
            <thead>
              <tr>
                <th>Method</th>
                <th className="num">Amount</th>
                <th>Approval code / reference</th>
                <th>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const m = methods.find((x) => x.id === r.methodId);
                return (
                  <tr key={`${r.methodId}-${i}`}>
                    <td>{m?.name ?? "?"}</td>
                    <td className="num">
                      <input
                        className="input till-input-big"
                        inputMode="decimal"
                        aria-label={`${m?.name ?? "Payment"} amount`}
                        value={r.amount}
                        onKeyDown={(e) => amountKey(e, i, r.amount)}
                        onChange={(e) => setRow(i, { amount: cleanAmount(e.target.value) })}
                      />
                    </td>
                    <td>
                      {m?.needsReference ? (
                        <input className="input till-input-big" aria-label={`${m.name} reference`} value={r.reference} maxLength={60} onChange={(e) => setRow(i, { reference: e.target.value })} />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <Button variant="link" aria-label={`Remove ${m?.name ?? "payment"}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                        ✕
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
        {cash && !refund ? (
          <div className="till-quick" role="group" aria-label="Cash received">
            <button type="button" className="till-key" onClick={() => quickCash(remainingFor(rows.findIndex((r) => r.methodId === cash.id)).toFixed(2))}>
              Exact cash
            </button>
            {QUICK_CASH.map((a) => (
              <button key={a} type="button" className="till-key" onClick={() => quickCash(a)}>
                ₹{a}
              </button>
            ))}
          </div>
        ) : null}
        {/* Launch check, 27 October 2026: a bill paid fully by gift card or points said only "Paid ₹0.00". */}
        {due.isZero() && !rows.length ? <p className="muted">Nothing more to pay: points, gift cards or credit cover the whole bill. Press Finish and print.</p> : null}
        <div className="till-pay-summary">
          <div>
            <span>{refund ? "Refunded" : "Paid"}</span>
            <strong>{rupees(check.paid.abs())}</strong>
          </div>
          {check.short.gt(0) ? (
            <div className="till-pay-short">
              <span>{refund ? "Still to refund" : "Still to pay"}</span>
              <strong>{rupees(check.short)}</strong>
            </div>
          ) : (
            <div className="till-change" aria-live="polite">
              <span>Change</span>
              <strong data-testid="pay-change">{rupees(check.change)}</strong>
            </div>
          )}
        </div>
        <Alert kind="error">{check.problem ?? onAccountProblem ?? bigChange ?? error}</Alert>
        <Button type="submit" variant="primary" className="till-big" busy={busy} disabled={!ready}>
          Finish and print (Enter)
        </Button>
      </form>
    </Dialog>
  );
}
