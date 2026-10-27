// Copyright (c) 2026, Rademics. All rights reserved.
// Shifts at the till (blueprint 09 process 1; decisions 41, 68; plan 06
// answers 4 and 6): open with starting cash (works offline), cash in / out
// during the shift, and close with a count of notes and coins. Closing needs
// the connection and an empty send queue; a difference above the setting needs
// a remark and a manager's PIN.
"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Decimal, DENOMINATIONS, denominationTotal } from "shared";
import { Alert, Button, Dialog } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import type { TillEngine } from "@/lib/till/engine";
import { rupees } from "@/lib/till/format";
import type { ServerShift } from "@/lib/till/types";
import { NumPad } from "./num-pad";
import { ManagerApprovalDialog } from "./pin-dialogs";

export function OpenShiftScreen({ engine, openedBy }: { engine: TillEngine; openedBy: string }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Launch check, 27 October 2026: an empty box became ₹0 without a question.
  const [zeroAsked, setZeroAsked] = useState(false);
  const zero = !/[1-9]/.test(amount);

  function change(value: string) {
    setAmount(value);
    setZeroAsked(false);
  }

  async function open(e?: FormEvent) {
    e?.preventDefault();
    if (zero && !zeroAsked) {
      setZeroAsked(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await engine.openShift(amount || "0", openedBy);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="till-center">
      <form className="card till-open" onSubmit={open}>
        <h1>Open the shift</h1>
        <p>Count the cash in the drawer before the first bill.</p>
        <label className="till-pin-label" htmlFor="till-start-cash">
          Starting cash (₹)
        </label>
        <input id="till-start-cash" className="input till-input-big" inputMode="decimal" value={amount} onChange={(e) => change(e.target.value.replace(/[^\d.]/g, ""))} autoFocus />
        <NumPad value={amount} onChange={change} label="Starting cash pad" />
        {zeroAsked ? <Alert>Starting cash ₹0: is the drawer really empty? If not, type the amount first.</Alert> : null}
        <Alert kind="error">{error}</Alert>
        <Button type="submit" variant="primary" className="till-big" busy={busy}>
          {zeroAsked ? "Yes, open with ₹0" : "Open shift"}
        </Button>
      </form>
    </div>
  );
}

export function CashDialog({ open, engine, onClose }: { open: boolean; engine: TillEngine; onClose: () => void }) {
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await engine.cashMovement(direction, amount, reason);
      setAmount("");
      setReason("");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title="Cash in or out" onClose={onClose}>
      <form onSubmit={save} className="till-pay">
        <div className="till-row" role="radiogroup" aria-label="Direction">
          {(["out", "in"] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={direction === d} className={`till-key${direction === d ? " is-selected" : ""}`} onClick={() => setDirection(d)}>
              {d === "out" ? "Cash out (petty payment)" : "Cash in (float top-up)"}
            </button>
          ))}
        </div>
        <label className="till-pin-label" htmlFor="till-cash-amount">
          Amount (₹)
        </label>
        <input id="till-cash-amount" className="input till-input-big" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        <label className="till-pin-label" htmlFor="till-cash-reason">
          Reason
        </label>
        <input id="till-cash-reason" className="input till-input-big" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Alert kind="error">{error}</Alert>
        <Button type="submit" variant="primary" className="till-big" busy={busy}>
          Save
        </Button>
      </form>
    </Dialog>
  );
}

type Counts = Record<string, string>;

export function CloseShiftDialog({ open, engine, online, onClose, onClosed }: { open: boolean; engine: TillEngine; online: boolean; onClose: () => void; onClosed: (s: ServerShift) => void }) {
  const [info, setInfo] = useState<{ shift: ServerShift; approvalAmount: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Counts>({});
  const [other, setOther] = useState<Counts>({});
  const [remarks, setRemarks] = useState("");
  const [approval, setApproval] = useState<{ token: string; manager: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    engine.closingInfo().then(
      (i) => {
        if (cancelled) return;
        setInfo(i);
        setLoadError(null);
        setOther(Object.fromEntries((i.shift.expected ?? []).filter((e) => e.kind !== "cash").map((e) => [e.paymentMethodId, e.expected])));
      },
      (e: unknown) => {
        if (!cancelled) setLoadError(errorMessage(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [engine, open]);

  const expected = info?.shift.expected ?? [];
  let cashCounted = new Decimal(0);
  let countProblem: string | null = null;
  try {
    cashCounted = denominationTotal(Object.fromEntries(Object.entries(notes).filter(([, v]) => v !== "").map(([k, v]) => [k, v])));
  } catch (e) {
    countProblem = errorMessage(e);
  }
  const firstCash = expected.find((e) => e.kind === "cash")?.paymentMethodId;
  const rows = expected.map((e) => {
    let counted: Decimal;
    if (e.kind === "cash") counted = e.paymentMethodId === firstCash ? cashCounted : new Decimal(0);
    else {
      try {
        counted = new Decimal(other[e.paymentMethodId] || "0");
      } catch {
        counted = new Decimal(0);
      }
    }
    return { ...e, counted, difference: counted.sub(new Decimal(e.expected)) };
  });
  const biggest = rows.reduce((m, r) => Decimal.max(m, r.difference.abs()), new Decimal(0));
  const needsApproval = !!info && biggest.gt(new Decimal(info.approvalAmount));

  async function close() {
    if (!info) return;
    if (countProblem) return setError(countProblem);
    if (needsApproval && !remarks.trim()) return setError(`The difference is more than ${rupees(info.approvalAmount)}; write a remark`);
    if (needsApproval && !approval) return setAsking(true);
    setBusy(true);
    setError(null);
    try {
      const denominations = Object.fromEntries(Object.entries(notes).filter(([, v]) => v !== "").map(([k, v]) => [k, Number.parseInt(v, 10)]));
      const counted = rows.filter((r) => r.kind !== "cash").map((r) => ({ paymentMethodId: r.paymentMethodId, amount: r.counted.toFixed(2) }));
      const closed = await engine.closeShift(info.shift.id, { denominations, counted, remarks: remarks.trim() || null, approvalToken: approval?.token });
      setInfo(null);
      setNotes({});
      setApproval(null);
      setRemarks("");
      onClosed(closed);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title="Close the shift" onClose={onClose}>
      {loadError ? (
        <Alert kind="error">{loadError}</Alert>
      ) : !info ? (
        <p className="muted">{online ? "Loading the shift…" : "Closing a shift needs the connection."}</p>
      ) : (
        <div className="till-close">
          <h3>Notes and coins in the drawer</h3>
          <div className="till-denoms">
            {DENOMINATIONS.map((d) => (
              <label key={d} className="till-denom">
                <span>₹{d}</span>
                <input
                  className="input till-input-small"
                  inputMode="numeric"
                  aria-label={`Count of ₹${d}`}
                  value={notes[d] ?? ""}
                  onChange={(e) => setNotes({ ...notes, [d]: e.target.value.replace(/\D/g, "") })}
                />
                <span className="muted">{rupees(new Decimal(d).mul(notes[d] || "0"))}</span>
              </label>
            ))}
          </div>
          <p className="till-dialog-lead">
            Cash counted: <strong>{rupees(cashCounted)}</strong>
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Method</th>
                <th className="num">Expected</th>
                <th className="num">Counted</th>
                <th className="num">Difference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.paymentMethodId} className={r.difference.isZero() ? undefined : "row-warn"}>
                  <td>{r.name}</td>
                  <td className="num">{rupees(r.expected)}</td>
                  <td className="num">
                    {r.kind === "cash" ? (
                      rupees(r.counted)
                    ) : (
                      <input
                        className="input till-input-small"
                        inputMode="decimal"
                        aria-label={`${r.name} counted`}
                        value={other[r.paymentMethodId] ?? ""}
                        onChange={(e) => setOther({ ...other, [r.paymentMethodId]: e.target.value.replace(/[^\d.-]/g, "") })}
                      />
                    )}
                  </td>
                  <td className={`num${r.difference.isNegative() ? " num-negative" : ""}`}>{rupees(r.difference)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {needsApproval ? (
            <>
              <Alert kind="info">
                The difference is more than {rupees(info.approvalAmount)}: write a remark and ask a manager to approve.
                {approval ? ` Approved by ${approval.manager}.` : ""}
              </Alert>
              <label className="till-pin-label" htmlFor="till-close-remarks">
                Remark
              </label>
              <textarea id="till-close-remarks" className="input" maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </>
          ) : null}
          <Alert kind="error">{error}</Alert>
          <Button variant="primary" className="till-big" busy={busy} onClick={() => void close()}>
            {needsApproval && !approval ? "Ask a manager and close" : "Close shift"}
          </Button>
          <ManagerApprovalDialog
            api={engine.api}
            online={online}
            request={asking ? { action: "cash_difference", details: `shift ${info.shift.businessDate} difference ${biggest.toFixed(2)}`, reason: `Cash difference of ${rupees(biggest)} at closing` } : null}
            onClose={() => setAsking(false)}
            onApproved={(token, manager) => {
              setApproval({ token, manager: manager.name });
              setAsking(false);
            }}
          />
        </div>
      )}
    </Dialog>
  );
}
