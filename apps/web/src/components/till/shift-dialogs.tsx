// Copyright (c) 2026, Rademics. All rights reserved.
// Shifts at the till (blueprint 09 process 1; decisions 41, 68; plan 06
// answers 4 and 6): open with starting cash (works offline), cash in / out
// during the shift, and close with a count of notes and coins. Closing needs
// the connection and an empty send queue; a difference above the setting needs
// a remark and a manager's PIN. Audit 5: the opening float is suggested from
// the last close (C7), a blind count hides the expected cash until the count
// is entered (C8), and cash out above the set amount needs a manager (C5).
"use client";

import { type FormEvent, useEffect, useState } from "react";
import { type ApprovalAction, Decimal, DENOMINATIONS, denominationTotal } from "shared";
import { Alert, Button, Dialog } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import type { TillEngine } from "@/lib/till/engine";
import { rupees } from "@/lib/till/format";
import type { ServerShift } from "@/lib/till/types";
import { NumPad } from "./num-pad";
import { ManagerApprovalDialog } from "./pin-dialogs";

export function OpenShiftScreen({ engine, openedBy }: { engine: TillEngine; openedBy: string }) {
  // C7: the cash counted at the last close is suggested; the cashier counts and changes it if needed.
  const [suggested] = useState(() => engine.suggestedFloat());
  const [amount, setAmount] = useState(() => suggested ?? "");
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
        {suggested !== null ? <p className="muted">Filled in from the cash counted at the last close ({rupees(suggested)}). Count the drawer and change it if it differs.</p> : null}
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

/** C5: the approval action for a large cash out (the server lists it with the others). */
const CASH_OUT: ApprovalAction = "cash_out";

/** C5: a cash out of more than the till's limit, or false. */
function cashOutOverLimit(direction: "in" | "out", amount: string, limit: string | null): boolean {
  if (direction !== "out" || limit === null) return false;
  try {
    return new Decimal(amount || "0").gt(new Decimal(limit));
  } catch {
    return false;
  }
}

export function CashDialog({ open, engine, onClose }: { open: boolean; engine: TillEngine; onClose: () => void }) {
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // C5: the manager's approval is for this cash out only; a change of amount or direction asks again.
  const [approval, setApproval] = useState<{ token: string; manager: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const limit = engine.cashOutApprovalAbove();
  const overLimit = cashOutOverLimit(direction, amount, limit);
  const state = engine.getState();
  const online = state.online && !state.signedOut;

  function changeAmount(value: string) {
    setAmount(value);
    setApproval(null);
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (overLimit && !approval) {
      if (!reason.trim()) return setError("Give a reason");
      return setAsking(true);
    }
    setBusy(true);
    setError(null);
    try {
      await engine.cashMovement(direction, amount, reason, overLimit ? approval?.token : undefined);
      setAmount("");
      setReason("");
      setApproval(null);
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
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              className={`till-key${direction === d ? " is-selected" : ""}`}
              onClick={() => {
                setDirection(d);
                setApproval(null);
              }}
            >
              {d === "out" ? "Cash out (petty payment)" : "Cash in (float top-up)"}
            </button>
          ))}
        </div>
        <label className="till-pin-label" htmlFor="till-cash-amount">
          Amount (₹)
        </label>
        <input id="till-cash-amount" className="input till-input-big" inputMode="decimal" value={amount} onChange={(e) => changeAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        <label className="till-pin-label" htmlFor="till-cash-reason">
          Reason
        </label>
        <input id="till-cash-reason" className="input till-input-big" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        {overLimit && limit !== null ? (
          <Alert kind="info">
            Cash out above {rupees(limit)} needs a manager&apos;s PIN{online ? "" : ", which needs the connection"}.{approval ? ` Approved by ${approval.manager}.` : ""}
          </Alert>
        ) : null}
        <Alert kind="error">{error}</Alert>
        <Button type="submit" variant="primary" className="till-big" busy={busy}>
          {overLimit && !approval ? "Ask a manager and save" : "Save"}
        </Button>
      </form>
      <ManagerApprovalDialog
        api={engine.api}
        online={online}
        request={asking ? { action: CASH_OUT, details: `cash out ${new Decimal(amount || "0").toFixed(2)}: ${reason.trim()}`, reason: `Cash out of ${rupees(amount || "0")} (${reason.trim()})`, amount: new Decimal(amount || "0").toFixed(2) } : null}
        onClose={() => setAsking(false)}
        onApproved={(token, manager) => {
          setApproval({ token, manager: manager.name });
          setAsking(false);
        }}
      />
    </Dialog>
  );
}

type Counts = Record<string, string>;

export function CloseShiftDialog({ open, engine, online, onClose, onClosed }: { open: boolean; engine: TillEngine; online: boolean; onClose: () => void; onClosed: (s: ServerShift) => void }) {
  const [info, setInfo] = useState<{ shift: ServerShift; approvalAmount: string; blindCount?: boolean } | null>(null);
  // C8: with a blind count, the expected cash shows only after the count is entered.
  const [counted, setCounted] = useState(false);
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
        setCounted(false);
        // C8: a blind count starts the other methods empty too, so nothing expected is shown.
        setOther(i.blindCount ? {} : Object.fromEntries((i.shift.expected ?? []).filter((e) => e.kind !== "cash").map((e) => [e.paymentMethodId, e.expected])));
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
  const hideExpected = !!info?.blindCount && !counted;

  // The manager approves one difference (the server compares the amount): a new count asks again.
  function changeNotes(next: Counts) {
    setNotes(next);
    setApproval(null);
  }

  function changeOther(next: Counts) {
    setOther(next);
    setApproval(null);
  }

  async function close() {
    if (!info) return;
    if (countProblem) return setError(countProblem);
    if (hideExpected) {
      // C8: the count is entered; now the expected cash and any difference are shown.
      setCounted(true);
      setError(null);
      return;
    }
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
      setCounted(false);
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
                  onChange={(e) => changeNotes({ ...notes, [d]: e.target.value.replace(/\D/g, "") })}
                />
                <span className="muted">{rupees(new Decimal(d).mul(notes[d] || "0"))}</span>
              </label>
            ))}
          </div>
          <p className="till-dialog-lead">
            Cash counted: <strong>{rupees(cashCounted)}</strong>
          </p>
          {hideExpected ? <p className="muted">Blind count: enter what you counted for each method; the expected amounts are shown after that.</p> : null}
          <table className="table">
            <thead>
              <tr>
                <th>Method</th>
                {hideExpected ? null : <th className="num">Expected</th>}
                <th className="num">Counted</th>
                {hideExpected ? null : <th className="num">Difference</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.paymentMethodId} className={hideExpected || r.difference.isZero() ? undefined : "row-warn"}>
                  <td>{r.name}</td>
                  {hideExpected ? null : <td className="num">{rupees(r.expected)}</td>}
                  <td className="num">
                    {r.kind === "cash" ? (
                      rupees(r.counted)
                    ) : (
                      <input
                        className="input till-input-small"
                        inputMode="decimal"
                        aria-label={`${r.name} counted`}
                        value={other[r.paymentMethodId] ?? ""}
                        onChange={(e) => changeOther({ ...other, [r.paymentMethodId]: e.target.value.replace(/[^\d.-]/g, "") })}
                      />
                    )}
                  </td>
                  {hideExpected ? null : <td className={`num${r.difference.isNegative() ? " num-negative" : ""}`}>{rupees(r.difference)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {needsApproval && !hideExpected ? (
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
            {hideExpected ? "Count entered: show expected" : needsApproval && !approval ? "Ask a manager and close" : "Close shift"}
          </Button>
          <ManagerApprovalDialog
            api={engine.api}
            online={online}
            request={asking ? { action: "cash_difference", details: `shift ${info.shift.businessDate} difference ${biggest.toFixed(2)}`, reason: `Cash difference of ${rupees(biggest)} at closing`, amount: biggest.abs().toFixed(2) } : null}
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
