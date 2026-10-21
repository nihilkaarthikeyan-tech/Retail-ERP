// Copyright (c) 2026, Rademics. All rights reserved.
// Small till dialogs: the customer (walk-in, find by mobile, quick add with
// name and mobile, module 3, and an optional birthday and anniversary, plan 11
// C10), bill options (coupon, bill discount), parked
// bills, and pairing the Till Helper printer program.
"use client";

import { type FormEvent, useEffect, useState } from "react";
import { businessDate, dayMonthYearProblem } from "shared";
import { blankDate, type DayMonthYear, DayMonthYearFields, joinDayMonth } from "@/components/parties/customer-dates-fields";
import { Alert, Button, Dialog } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import type { ParkedBill, TillEngine } from "@/lib/till/engine";
import { dateTimeIn } from "@/lib/till/format";
import { type DraftBill, type DraftCustomer, findCustomerByMobile } from "@/lib/till/pricing";
import { helperStatus, helperToken, pairHelper } from "@/lib/till/receipt";
import type { TillSnapshot } from "@/lib/till/types";

export function CustomerDialog({ open, snapshot, current, newId, onPick, onClose }: { open: boolean; snapshot: TillSnapshot; current: DraftCustomer | null; newId: () => string; onPick: (c: DraftCustomer | null) => void; onClose: () => void }) {
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [more, setMore] = useState(false);
  const [birthday, setBirthday] = useState<DayMonthYear>(blankDate);
  const [anniversary, setAnniversary] = useState<DayMonthYear>(blankDate);
  const [error, setError] = useState<string | null>(null);
  const digits = mobile.replace(/\D/g, "");
  const found = digits.length === 10 ? findCustomerByMobile(snapshot, digits) : undefined;

  function addNew(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{10}$/.test(digits)) return setError("Enter the 10-digit mobile number");
    if (!name.trim()) return setError("Enter the customer's name");
    // Plan 11 C10: both optional; checked here so the bill never carries a date that is not real.
    const dates: Pick<DraftCustomer, "birthday" | "birthYear" | "anniversary" | "anniversaryYear"> = {};
    for (const [label, v, dm, yr] of [
      ["Birthday", birthday, "birthday", "birthYear"],
      ["Anniversary", anniversary, "anniversary", "anniversaryYear"],
    ] as const) {
      if (!v.day && !v.month && !v.year.trim()) continue;
      if (!v.day || !v.month) return setError(`${label}: choose both the day and the month`);
      if (v.year.trim() && !/^\d{4}$/.test(v.year.trim())) return setError(`${label}: the year as four digits, e.g. 1990`);
      const { dayMonth, year } = joinDayMonth(v);
      const problem = dayMonthYearProblem(dayMonth, year, businessDate());
      if (problem) return setError(`${label}: ${problem}`);
      Object.assign(dates, { [dm]: dayMonth, [yr]: year });
    }
    onPick({ id: null, name: name.trim(), mobile: digits, gstin: null, stateCode: null, customerGroupId: null, newClientId: newId(), ...dates });
    setMobile("");
    setName("");
    setMore(false);
    setBirthday(blankDate);
    setAnniversary(blankDate);
    setError(null);
  }

  return (
    <Dialog open={open} title="Customer" onClose={onClose}>
      <p className="till-dialog-lead">Now: {current ? `${current.name}${current.mobile ? ` (${current.mobile})` : ""}` : "Walk-in customer"}</p>
      <label className="till-pin-label" htmlFor="till-cust-mobile">
        Mobile number
      </label>
      <input id="till-cust-mobile" className="input till-input-big" inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))} autoFocus />
      {found ? (
        <div className="till-found">
          <span>
            {found.name} <span className="muted">{found.code}</span>
          </span>
          <Button
            variant="primary"
            onClick={() => {
              onPick({ id: found.id, name: found.name, mobile: found.mobile, gstin: found.gstin, taxSituation: found.taxSituation ?? null, stateCode: found.stateCode, customerGroupId: found.customerGroupId });
              setMobile("");
            }}
          >
            Use this customer
          </Button>
        </div>
      ) : digits.length === 10 ? (
        <form onSubmit={addNew}>
          <p className="muted">No customer with this mobile on the till. Add them:</p>
          <label className="till-pin-label" htmlFor="till-cust-name">
            Name
          </label>
          <input id="till-cust-name" className="input till-input-big" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="button" aria-expanded={more} onClick={() => setMore((m) => !m)}>
            {more ? "Fewer details" : "More: birthday, anniversary"}
          </Button>
          {more ? (
            <div className="till-cust-dates">
              <DayMonthYearFields idPrefix="till-cust-birthday" label="Birthday" value={birthday} onChange={setBirthday} />
              <DayMonthYearFields idPrefix="till-cust-anniversary" label="Anniversary" value={anniversary} onChange={setAnniversary} />
            </div>
          ) : null}
          <Alert kind="error">{error}</Alert>
          <Button type="submit" variant="primary">
            Add customer
          </Button>
        </form>
      ) : null}
      <div className="actions">
        <Button onClick={() => onPick(null)}>Walk-in customer</Button>
      </div>
    </Dialog>
  );
}

export function BillOptionsDialog({
  open,
  draft,
  coupons = true,
  onSave,
  onClose,
}: {
  open: boolean;
  draft: DraftBill;
  /** Plan 12: "Offers and coupons" is on; when off only the bill discount is asked for. */
  coupons?: boolean;
  onSave: (patch: Pick<DraftBill, "couponCode" | "billDiscount">) => void;
  onClose: () => void;
}) {
  const [coupon, setCoupon] = useState(draft.couponCode ?? "");
  const [kind, setKind] = useState<"percent" | "amount">(draft.billDiscount?.amount ? "amount" : "percent");
  const [value, setValue] = useState(draft.billDiscount?.amount ?? draft.billDiscount?.percent ?? "");
  return (
    <Dialog open={open} title={coupons ? "Coupon and bill discount" : "Bill discount"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = value.trim();
          onSave({ couponCode: (coupons && coupon.trim().toUpperCase()) || null, billDiscount: v ? (kind === "amount" ? { amount: v } : { percent: v }) : null });
        }}
      >
        {coupons ? (
          <>
            <label className="till-pin-label" htmlFor="till-coupon">
              Coupon code
            </label>
            <input id="till-coupon" className="input till-input-big" maxLength={40} value={coupon} onChange={(e) => setCoupon(e.target.value)} />
          </>
        ) : null}
        <h3>Discount on the whole bill</h3>
        <div className="till-row" role="radiogroup" aria-label="Discount kind">
          {(["percent", "amount"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={`till-key${kind === k ? " is-selected" : ""}`} onClick={() => setKind(k)}>
              {k === "percent" ? "Percent %" : "Rupees ₹"}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="till-bill-discount">
          Bill discount
        </label>
        <input id="till-bill-discount" className="input till-input-big" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} />
        <p className="muted">Above the cashier&apos;s limit a manager approves it. A typed discount replaces any whole-bill offer.</p>
        <div className="actions">
          <Button type="submit" variant="primary">
            Apply
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function ParkedDialog({ open, engine, onRecall, onClose }: { open: boolean; engine: TillEngine; onRecall: (id: string) => void; onClose: () => void }) {
  const [list, setList] = useState<ParkedBill[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    engine.parked().then((p) => {
      if (!cancelled) setList(p);
    });
    return () => {
      cancelled = true;
    };
  }, [engine, open]);
  return (
    <Dialog open={open} title="Parked bills" onClose={onClose}>
      {list.length ? (
        <ul className="till-list">
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" className="till-list-button" onClick={() => onRecall(p.id)}>
                <span>{p.label}</span>
                <span className="muted">{dateTimeIn(p.parkedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No parked bills on this till.</p>
      )}
    </Dialog>
  );
}

export function HelperDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    helperStatus().then((s) => {
      if (!cancelled) setStatus(s ? "The Till Helper is paired and running." : helperToken() ? "The Till Helper is paired but not answering; receipts print through the browser." : "Not paired; receipts print through the browser.");
    });
    return () => {
      cancelled = true;
    };
  }, [open, busy]);

  async function pair(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await pairHelper(code);
      setCode("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title="Receipt printer (Till Helper)" onClose={onClose}>
      <p>{status ?? "Checking…"}</p>
      <form onSubmit={pair}>
        <label className="till-pin-label" htmlFor="till-helper-code">
          Pairing code shown by the Till Helper
        </label>
        <input id="till-helper-code" className="input till-input-big" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
        <Alert kind="error">{error}</Alert>
        <Button type="submit" variant="primary" busy={busy}>
          Pair
        </Button>
      </form>
    </Dialog>
  );
}
