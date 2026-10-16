// Copyright (c) 2026, Rademics. All rights reserved.
// Manager PIN approvals (decision 40) and quick cashier switching (decision
// 68). Both need the connection: PINs are checked on the server and never
// stored on the till (pos-offline answer 3).
"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { ApprovalAction } from "shared";
import { Alert, Button, Dialog } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import type { Person } from "@/lib/till/types";
import type { TillApi } from "@/lib/till/till-api";
import { NumPad } from "./num-pad";

function usePeople(api: TillApi, online: boolean, open: boolean) {
  const [people, setPeople] = useState<{ managers: Person[]; cashiers: Person[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !online) return;
    let cancelled = false;
    api.people().then(
      (p) => {
        if (!cancelled) setPeople(p);
      },
      (e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, online, open]);
  return { people, error };
}

function PinForm({ people, chooseLabel, submitLabel, onSubmit }: { people: Person[]; chooseLabel: string; submitLabel: string; onSubmit: (personId: string, pin: string) => Promise<void> }) {
  const [personId, setPersonId] = useState(people.length === 1 ? people[0].id : "");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!personId) return setError(`Choose the ${chooseLabel.toLowerCase()}`);
    if (!/^\d{4,6}$/.test(pin)) return setError("The PIN is 4 to 6 digits");
    setBusy(true);
    setError(null);
    try {
      await onSubmit(personId, pin);
    } catch (err) {
      setError(errorMessage(err));
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  if (!people.length) return <Alert kind="info">Nobody here has set a till PIN yet. Each person sets one under Billing counter → My till PIN.</Alert>;
  return (
    <form onSubmit={submit} className="till-pin">
      <fieldset className="till-people">
        <legend>{chooseLabel}</legend>
        {people.map((p) => (
          <button key={p.id} type="button" className={`till-person${personId === p.id ? " is-selected" : ""}`} aria-pressed={personId === p.id} onClick={() => setPersonId(p.id)}>
            {p.name}
          </button>
        ))}
      </fieldset>
      <label className="till-pin-label" htmlFor="till-pin-input">
        PIN
      </label>
      <input
        id="till-pin-input"
        className="input till-pin-input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        autoFocus
      />
      <NumPad value={pin} onChange={(v) => setPin(v.slice(0, 6))} integer maxLength={6} label="PIN pad" />
      <Alert kind="error">{error}</Alert>
      <Button type="submit" variant="primary" busy={busy} className="till-big">
        {submitLabel}
      </Button>
    </form>
  );
}

export interface ApprovalRequest {
  action: ApprovalAction;
  /** Shown to the manager and stored in the history, e.g. "ITM-000001 12%". */
  details: string;
  reason: string;
}

/** A manager types their PIN; the till gets a single-use approval for one action. */
export function ManagerApprovalDialog({ api, online, request, onApproved, onClose }: { api: TillApi; online: boolean; request: ApprovalRequest | null; onApproved: (token: string, manager: Person) => void; onClose: () => void }) {
  const { people, error } = usePeople(api, online, !!request);
  return (
    <Dialog open={!!request} title="Manager approval" onClose={onClose}>
      {request ? <p className="till-dialog-lead">{request.reason}</p> : null}
      {!online ? (
        <Alert kind="error">Needs the connection. Manager approvals are checked on the server; try again when the till is online.</Alert>
      ) : error ? (
        <Alert kind="error">{error}</Alert>
      ) : !people ? (
        <p className="muted">Loading…</p>
      ) : (
        <PinForm
          people={people.managers}
          chooseLabel="Manager"
          submitLabel="Approve"
          onSubmit={async (managerId, pin) => {
            const res = await api.approve({ managerId, pin, action: request!.action, details: request!.details.slice(0, 200) });
            onApproved(res.token, res.manager);
          }}
        />
      )}
    </Dialog>
  );
}

/** The till is locked; the next cashier types their PIN (decision 68). */
export function LockScreen({ api, online, current, onSwitch, onResume }: { api: TillApi; online: boolean; current: string | null; onSwitch: (userId: string, pin: string) => Promise<void>; onResume: () => void }) {
  const { people, error } = usePeople(api, online, true);
  return (
    <div className="till-lock" role="dialog" aria-modal="true" aria-labelledby="till-lock-title">
      <div className="till-lock-box">
        <h1 id="till-lock-title">Till locked</h1>
        {!online ? (
          <>
            <Alert kind="info">Switching cashier needs the connection. {current ? `${current} can carry on.` : ""}</Alert>
            {current ? (
              <Button variant="primary" className="till-big" onClick={onResume}>
                Back to billing as {current}
              </Button>
            ) : null}
          </>
        ) : error ? (
          <Alert kind="error">{error}</Alert>
        ) : !people ? (
          <p className="muted">Loading…</p>
        ) : (
          <PinForm people={people.cashiers} chooseLabel="Cashier" submitLabel="Unlock" onSubmit={onSwitch} />
        )}
      </div>
    </div>
  );
}
