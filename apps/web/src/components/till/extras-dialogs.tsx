// Copyright (c) 2026, Rademics. All rights reserved.
// Till dialogs for plan 11: the salesperson of the bill or of one line
// (picked, typed or scanned by code; C1) and home-delivery details (B4).
// Both work offline: the salespeople come with the till's saved copy.
"use client";

import { type FormEvent, useState } from "react";
import { Alert, Button, Dialog } from "@/components/ui";
import { rupees } from "@/lib/till/format";
import type { DraftDelivery } from "@/lib/till/pricing";
import type { SnapSalesStaff } from "@/lib/till/types";

/** The salesperson whose code was typed or scanned (codes are kept in capitals). */
export function staffByCode(staff: SnapSalesStaff[], code: string): SnapSalesStaff | undefined {
  const c = code.trim().toUpperCase();
  return c ? staff.find((s) => s.code === c) : undefined;
}

export function SalespersonDialog({
  open,
  staff,
  current,
  forLine,
  onPick,
  onClose,
}: {
  open: boolean;
  staff: SnapSalesStaff[];
  current: string | null;
  /** The line's item name when choosing for one line; the bill's salesperson otherwise. */
  forLine?: string | null;
  /** null: no salesperson (for a line: the bill's salesperson). */
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function byCode(e: FormEvent) {
    e.preventDefault();
    const s = staffByCode(staff, code);
    if (!s) return setError(`No salesperson with code ${code.trim().toUpperCase()} in this store`);
    setCode("");
    setError(null);
    onPick(s.id);
  }

  return (
    <Dialog open={open} title={forLine ? `Salesperson for ${forLine}` : "Salesperson for the bill"} onClose={onClose}>
      <form onSubmit={byCode}>
        <label className="till-pin-label" htmlFor="till-staff-code">
          Type or scan the code
        </label>
        <input
          id="till-staff-code"
          className="input till-input-big mono"
          autoComplete="off"
          maxLength={10}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          autoFocus
        />
        <Alert kind="error">{error}</Alert>
      </form>
      {staff.length ? (
        <ul className="till-results" aria-label="Salespeople">
          {staff.map((s) => (
            <li key={s.id}>
              <button type="button" className={`till-list-button${s.id === current ? " is-selected" : ""}`} aria-pressed={s.id === current} onClick={() => onPick(s.id)}>
                <span>{s.name}</span>
                <span className="mono muted">{s.code}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No salespeople are set up for this store. A manager adds them under Billing counter, Sales staff.</p>
      )}
      <div className="actions">
        <Button onClick={() => onPick(null)}>{forLine ? "Same as the bill" : "No salesperson"}</Button>
      </div>
    </Dialog>
  );
}

const EMPTY: DraftDelivery = { name: "", address: "", phone: "", deliverOn: "", remarks: "" };

export function DeliveryDialog({
  open,
  current,
  defaults,
  today,
  charge,
  onSave,
  onClose,
}: {
  open: boolean;
  current: DraftDelivery | null;
  /** The bill's customer, to fill the name and phone. */
  defaults: { name: string; phone: string };
  today: string;
  /** The store's charge and "free above" amount, for the cashier to tell the customer. */
  charge: { charge: string; freeAbove: string | null } | null;
  onSave: (d: DraftDelivery | null) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<DraftDelivery>(() => current ?? { ...EMPTY, name: defaults.name, phone: defaults.phone, deliverOn: today });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof DraftDelivery, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function save(e: FormEvent) {
    e.preventDefault();
    if (!form.address.trim()) return setError("Enter the address to deliver to");
    if (form.phone.trim() && !/^\d{10}$/.test(form.phone.trim())) return setError("The phone number must be 10 digits");
    if (form.deliverOn && form.deliverOn < today) return setError("The delivery date cannot be before today");
    setError(null);
    onSave({ ...form, name: form.name.trim(), address: form.address.trim(), phone: form.phone.trim(), remarks: form.remarks.trim() });
  }

  const chargeText = !charge || !Number(charge.charge) ? "No delivery charge is set for this store." : `Delivery charge ${rupees(charge.charge)}${charge.freeAbove ? `, free for bills of ${rupees(charge.freeAbove)} or more` : ""}.`;

  return (
    <Dialog open={open} title="Home delivery" onClose={onClose}>
      <form onSubmit={save} noValidate>
        <p className="muted">{chargeText}</p>
        <label className="till-pin-label" htmlFor="till-del-name">
          Deliver to (name)
        </label>
        <input id="till-del-name" className="input" maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} />
        <label className="till-pin-label" htmlFor="till-del-address">
          Address
        </label>
        <textarea id="till-del-address" className="input" rows={3} maxLength={500} value={form.address} onChange={(e) => set("address", e.target.value)} autoFocus />
        <label className="till-pin-label" htmlFor="till-del-phone">
          Phone
        </label>
        <input id="till-del-phone" className="input" inputMode="numeric" maxLength={10} value={form.phone} onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))} />
        <label className="till-pin-label" htmlFor="till-del-date">
          Deliver on
        </label>
        <input id="till-del-date" className="input" type="date" min={today} value={form.deliverOn} onChange={(e) => set("deliverOn", e.target.value)} />
        <label className="till-pin-label" htmlFor="till-del-remarks">
          Remarks
        </label>
        <input id="till-del-remarks" className="input" maxLength={300} value={form.remarks} onChange={(e) => set("remarks", e.target.value)} />
        <Alert kind="error">{error}</Alert>
        <div className="actions">
          <Button type="submit" variant="primary">
            Save delivery
          </Button>
          {current ? <Button onClick={() => onSave(null)}>No delivery</Button> : null}
        </div>
      </form>
    </Dialog>
  );
}
