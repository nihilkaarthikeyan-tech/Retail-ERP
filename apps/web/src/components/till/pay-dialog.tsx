// Copyright (c) 2026, Rademics. All rights reserved.
// Paying a bill (blueprint 09 process 3; plan 06 §6 "Pay"): cash, card and UPI
// split from the till's own methods, references for methods that need them,
// change shown big. Refunds only by methods allowed for refunds. The payments
// are part of the saved bill, so they survive a crash too.
"use client";

import { Decimal } from "shared";
import { Alert, Button, Dialog } from "@/components/ui";
import { rupees } from "@/lib/till/format";
import { checkPayments, type DraftBill, type DraftPayment } from "@/lib/till/pricing";
import type { SnapPaymentMethod } from "@/lib/till/types";

const QUICK_CASH = ["100", "200", "500", "2000"];

interface PayDialogProps {
  open: boolean;
  net: Decimal;
  draft: DraftBill;
  methods: SnapPaymentMethod[];
  busy: boolean;
  error: string | null;
  onChange: (payments: DraftPayment[]) => void;
  onFinish: () => void;
  onClose: () => void;
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

export function PayDialog({ open, net, draft, methods, busy, error, onChange, onFinish, onClose }: PayDialogProps) {
  const refund = net.isNegative();
  const due = net.abs();
  const usable = methods.filter((m) => m.active && (!refund || m.allowRefund));
  const rows = draft.payments;
  const check = checkPayments(net, rows, methods);
  const cash = usable.find((m) => m.kind === "cash" && m.isDefault) ?? usable.find((m) => m.kind === "cash");

  function remainingFor(index: number): Decimal {
    const others = sum(rows.filter((_, i) => i !== index));
    const left = due.sub(others);
    return left.isNegative() ? new Decimal(0) : left;
  }

  function setRow(index: number, patch: Partial<DraftPayment>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addMethod(m: SnapPaymentMethod, amount?: string) {
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

  const ready = !check.problem && check.short.isZero() && (rows.length > 0 || net.isZero());
  return (
    <Dialog open={open} title={refund ? "Refund" : "Payment"} onClose={onClose}>
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
        <div className="till-pay-methods" role="group" aria-label="Payment methods">
          {usable.map((m) => (
            <button key={m.id} type="button" className="till-key till-method" onClick={() => addMethod(m)}>
              {m.name}
            </button>
          ))}
        </div>
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
                        onChange={(e) => setRow(i, { amount: e.target.value.replace(/[^\d.]/g, "") })}
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
        <Alert kind="error">{check.problem ?? error}</Alert>
        <Button type="submit" variant="primary" className="till-big" busy={busy} disabled={!ready}>
          Finish and print (Enter)
        </Button>
      </form>
    </Dialog>
  );
}
