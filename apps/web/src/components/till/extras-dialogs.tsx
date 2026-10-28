// Copyright (c) 2026, Rademics. All rights reserved.
// Till dialogs for plan 11: the salesperson of the bill or of one line
// (picked, typed or scanned by code; C1) and home-delivery details (B4).
// Plan 08 G4, G5: the buyer's GSTIN for a business tax invoice, or the name,
// address and state of a consumer. All work offline: the salespeople come with
// the till's saved copy and the GSTIN is checked on the till (and again on the server).
"use client";

import { type FormEvent, useState } from "react";
import { INDIAN_STATE_OPTIONS, INDIAN_STATES } from "shared";
import { Alert, Button, Dialog } from "@/components/ui";
import { rupees } from "@/lib/till/format";
import { buyerProblem, type DraftBuyer, type DraftDelivery } from "@/lib/till/pricing";
import type { SnapCustomer, SnapSalesStaff } from "@/lib/till/types";

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

const EMPTY: DraftDelivery = { name: "", address: "", phone: "", deliverOn: "", remarks: "", stateCode: "" };

/** A state picker (GST state codes), empty = not given. */
function StateSelect({ id, value, onChange, emptyLabel }: { id: string; value: string; onChange: (v: string) => void; emptyLabel: string }) {
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {INDIAN_STATE_OPTIONS.map(([code, name]) => (
        <option key={code} value={code}>
          {name} ({code})
        </option>
      ))}
    </select>
  );
}

const NO_BUYER: DraftBuyer = { gstin: "", name: "", address: "", stateCode: "" };

/**
 * Plan 08 G4, G5: who the bill is for. With a GSTIN it becomes a business tax
 * invoice (IGST when the GSTIN is from another state); without one, the name,
 * address and state make a consumer invoice (needed from ₹50,000 taxable value).
 */
export function BuyerDialog({
  open,
  current,
  defaults,
  customers = [],
  onSave,
  onClose,
}: {
  open: boolean;
  current: DraftBuyer | null;
  defaults: { name: string };
  /** The till's saved customers: a GSTIN typed for one of them fills in the name (launch check, 27 October 2026). */
  customers?: Pick<SnapCustomer, "name" | "gstin">[];
  onSave: (b: DraftBuyer | null) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<DraftBuyer>(() => current ?? { ...NO_BUYER, name: defaults.name });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof DraftBuyer, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const gstin = form.gstin.trim().toUpperCase();

  function setGstin(value: string) {
    const known = value.length === 15 ? customers.find((c) => c.gstin?.toUpperCase() === value) : undefined;
    setForm((f) => ({ ...f, gstin: value, ...(known && !f.name.trim() ? { name: known.name } : {}) }));
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const clean: DraftBuyer = { gstin, name: form.name.trim(), address: form.address.trim(), stateCode: gstin.length >= 2 ? gstin.slice(0, 2) : form.stateCode };
    const problem = buyerProblem(clean);
    if (problem) return setError(problem);
    setError(null);
    onSave(clean.gstin || clean.name || clean.address || clean.stateCode ? clean : null);
  }

  return (
    <Dialog open={open} title="Buyer on the bill" onClose={onClose}>
      <form onSubmit={save} noValidate>
        <p className="muted">Type or scan the buyer’s GSTIN for a business tax invoice. Without a GSTIN the bill is a consumer bill; give the name, address and state when the buyer asks, and always from ₹50,000.</p>
        <label className="till-pin-label" htmlFor="till-buyer-gstin">
          GSTIN
        </label>
        <input id="till-buyer-gstin" className="input mono" autoComplete="off" maxLength={15} value={form.gstin} onChange={(e) => setGstin(e.target.value.toUpperCase().trim())} autoFocus />
        <label className="till-pin-label" htmlFor="till-buyer-name">
          Name
        </label>
        <input id="till-buyer-name" className="input" maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} />
        <label className="till-pin-label" htmlFor="till-buyer-address">
          Address
        </label>
        <textarea id="till-buyer-address" className="input" rows={3} maxLength={500} value={form.address} onChange={(e) => set("address", e.target.value)} />
        <label className="till-pin-label" htmlFor="till-buyer-state">
          State
        </label>
        {gstin.length >= 2 ? (
          <p className="muted" id="till-buyer-state">
            From the GSTIN: {INDIAN_STATES[gstin.slice(0, 2)] ? `${INDIAN_STATES[gstin.slice(0, 2)]} (${gstin.slice(0, 2)})` : gstin.slice(0, 2)}
          </p>
        ) : (
          <StateSelect id="till-buyer-state" value={form.stateCode} onChange={(v) => set("stateCode", v)} emptyLabel="Not given" />
        )}
        <Alert kind="error">{error}</Alert>
        <div className="actions">
          <Button type="submit" variant="primary">
            Save buyer
          </Button>
          {current ? <Button onClick={() => onSave(null)}>No buyer details</Button> : null}
        </div>
      </form>
    </Dialog>
  );
}

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
    onSave({ ...form, name: form.name.trim(), address: form.address.trim(), phone: form.phone.trim(), remarks: form.remarks.trim(), stateCode: form.stateCode || "" });
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
        <label className="till-pin-label" htmlFor="till-del-state">
          State
        </label>
        <StateSelect id="till-del-state" value={form.stateCode ?? ""} onChange={(v) => set("stateCode", v)} emptyLabel="This store's state" />
        <label className="till-pin-label">
          <input type="checkbox" checked={!!form.forOther} onChange={(e) => setForm((f) => ({ ...f, forOther: e.target.checked }))} /> Delivered to someone else on a business buyer&apos;s order (GST goes by the buyer&apos;s own state)
        </label>
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
