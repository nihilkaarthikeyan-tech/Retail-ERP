// Copyright (c) 2026, Rademics. All rights reserved.
// Till dialogs for plan 11 part 2: customer orders (find an order, take an
// advance, collect it on the bill, cancel it with a refund or keeping the
// credit) and alteration jobs (a new job slip, moving it through the tailor,
// billing its charge with the purchase or on collection, handing it back).
// They need the connection: the server checks the advances and the jobs.
"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Decimal } from "shared";
import { Alert, Badge, Button, Dialog } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import type { TillEngine } from "@/lib/till/engine";
import { rupees } from "@/lib/till/format";
import type { DraftCustomer } from "@/lib/till/pricing";
import type { StoredSnapshot, TillAlteration, TillOrder } from "@/lib/till/types";
import { type ApprovalRequest, ManagerApprovalDialog } from "./pin-dialogs";

const ORDER_STATUS: Record<TillOrder["status"], string> = { open: "Open", ready: "Ready", collected: "Collected", cancelled: "Cancelled" };
const JOB_STATUS: Record<TillAlteration["status"], string> = { received: "Received", with_tailor: "With the tailor", ready: "Ready", delivered: "Delivered", cancelled: "Cancelled" };
const NEXT: Partial<Record<TillAlteration["status"], { status: TillAlteration["status"]; label: string }>> = {
  received: { status: "with_tailor", label: "Given to the tailor" },
  with_tailor: { status: "ready", label: "Back from the tailor" },
};

const NEEDS_CONNECTION = "Orders and alterations need the connection. Try again when the till is online.";

// ---- Customer orders ----

export function OrdersDialog({
  open,
  engine,
  snapshot,
  online,
  onCollect,
  onClose,
}: {
  open: boolean;
  engine: TillEngine;
  snapshot: StoredSnapshot;
  online: boolean;
  /** Puts the order's lines on the bill at the agreed prices, with its advance. */
  onCollect: (order: TillOrder) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<TillOrder[] | null>(null);
  const [order, setOrder] = useState<TillOrder | null>(null);
  const [mode, setMode] = useState<"view" | "advance" | "cancel">("view");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const methods = snapshot.till.paymentMethods.filter((m) => m.active && m.kind !== "on_account");
  const [form, setForm] = useState({ methodId: "", amount: "", reference: "", reason: "", outcome: "keep_credit" as "refund" | "keep_credit" });

  async function find(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    try {
      const res = await engine.api.findOrders(search.trim(), snapshot.till.store.id);
      setRows(res.rows.filter((r) => r.status === "open" || r.status === "ready"));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function choose(id: string) {
    setError(null);
    try {
      setOrder(await engine.api.order(id));
      setMode("view");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function takeAdvance(e: FormEvent) {
    e.preventDefault();
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const method = methods.find((m) => m.id === form.methodId);
      if (!method) throw new Error("Choose how the advance is paid");
      setOrder(await engine.api.orderAdvance(order.id, { clientId: engine.uuid(), paymentMethodId: method.id, amount: form.amount.trim(), reference: form.reference.trim() || null }));
      setMode("view");
      setForm({ ...form, amount: "", reference: "" });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(approvalToken?: string) {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      if (!form.reason.trim()) throw new Error("Give the reason for cancelling the order");
      const body = { clientId: engine.uuid(), reason: form.reason.trim(), outcome: form.outcome, ...(form.outcome === "refund" ? { paymentMethodId: form.methodId, reference: form.reference.trim() || null, approvalToken } : {}) };
      setOrder(await engine.api.cancelOrder(order.id, body));
      setMode("view");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function startCancel(e: FormEvent) {
    e.preventDefault();
    if (!order) return;
    if (form.outcome === "refund") {
      if (!form.methodId) return setError("Choose how the advance is paid back");
      setApproval({ action: "order_refund", details: `Order ${order.number}: refund ${rupees(order.advanceHeld)}`, reason: `Refund the advance of ${rupees(order.advanceHeld)} for order ${order.number}. A manager must approve it.` });
      return;
    }
    void cancel();
  }

  if (approval) {
    return (
      <ManagerApprovalDialog
        api={engine.api}
        online={online}
        request={approval}
        onApproved={(token) => {
          setApproval(null);
          void cancel(token);
        }}
        onClose={() => setApproval(null)}
      />
    );
  }

  const refundMethods = methods.filter((m) => m.allowRefund);
  return (
    <Dialog open={open} title={order ? `Order ${order.number}` : "Customer orders"} onClose={onClose}>
      {!online ? <Alert kind="error">{NEEDS_CONNECTION}</Alert> : null}
      <Alert kind="error">{error}</Alert>
      {!order ? (
        <>
          <form className="till-row" onSubmit={find}>
            <input className="input" aria-label="Order number, customer name or mobile" placeholder="Order number, customer name or mobile" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button type="submit" variant="primary" disabled={!online}>
              Find
            </Button>
          </form>
          {rows && !rows.length ? <p className="muted">No open or ready orders found.</p> : null}
          <ul className="till-results" aria-label="Orders found">
            {(rows ?? []).map((r) => (
              <li key={r.id}>
                <button type="button" className="till-list-button" onClick={() => void choose(r.id)}>
                  <span>
                    <span className="mono">{r.number}</span> {r.customer?.name} {r.overdue ? <Badge kind="warn">Overdue</Badge> : null}
                  </span>
                  <span>
                    {ORDER_STATUS[r.status]} · {rupees(r.total)} · advance {rupees(r.advanceHeld)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p>
            <strong>{order.customer?.name}</strong> {order.customer?.mobile ? <span className="muted">{order.customer.mobile}</span> : null} · {ORDER_STATUS[order.status]}
            {order.expectedOn ? ` · expected ${order.expectedOn}` : ""}
          </p>
          <table className="table">
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.item.name}</td>
                  <td className="num">
                    {l.quantity} {l.unitCode}
                  </td>
                  <td className="num">{rupees(l.price)}</td>
                  <td className="num">{rupees(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p data-testid="order-money">
            Total {rupees(order.total)} · advance held <strong>{rupees(order.advanceHeld)}</strong> · to pay on collection {rupees(Decimal.max(0, new Decimal(order.total).sub(order.advanceHeld)))}
          </p>
          {mode === "advance" ? (
            <form onSubmit={takeAdvance} aria-label="Take an advance">
              <div className="till-row">
                <select className="input" aria-label="Paid by" value={form.methodId} onChange={(e) => setForm({ ...form, methodId: e.target.value })}>
                  <option value="">Paid by…</option>
                  {methods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <input className="input" aria-label="Advance amount" inputMode="decimal" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                <input className="input" aria-label="Reference" placeholder="Reference (card or UPI)" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
              </div>
              <div className="actions">
                <Button type="submit" variant="primary" busy={busy}>
                  Take the advance
                </Button>
                <Button onClick={() => setMode("view")}>Back</Button>
              </div>
            </form>
          ) : mode === "cancel" ? (
            <form onSubmit={startCancel} aria-label="Cancel the order">
              <input className="input" aria-label="Reason" placeholder="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              {new Decimal(order.advanceHeld).gt(0) ? (
                <div className="till-row" role="radiogroup" aria-label="The advance">
                  <label>
                    <input type="radio" name="outcome" checked={form.outcome === "keep_credit"} onChange={() => setForm({ ...form, outcome: "keep_credit" })} /> Keep {rupees(order.advanceHeld)} as credit
                  </label>
                  <label>
                    <input type="radio" name="outcome" checked={form.outcome === "refund"} onChange={() => setForm({ ...form, outcome: "refund" })} /> Refund it (manager PIN)
                  </label>
                </div>
              ) : null}
              {form.outcome === "refund" && new Decimal(order.advanceHeld).gt(0) ? (
                <div className="till-row">
                  <select className="input" aria-label="Refund by" value={form.methodId} onChange={(e) => setForm({ ...form, methodId: e.target.value })}>
                    <option value="">Refund by…</option>
                    {refundMethods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <input className="input" aria-label="Refund reference" placeholder="Reference" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
                </div>
              ) : null}
              <div className="actions">
                <Button type="submit" variant="danger" busy={busy}>
                  Cancel the order
                </Button>
                <Button onClick={() => setMode("view")}>Back</Button>
              </div>
            </form>
          ) : (
            <div className="actions">
              {order.status === "open" || order.status === "ready" ? (
                <>
                  <Button variant="primary" onClick={() => onCollect(order)} disabled={!online}>
                    Collect on this bill
                  </Button>
                  <Button onClick={() => setMode("advance")} disabled={!online}>
                    Take an advance
                  </Button>
                  <Button
                    onClick={() => {
                      setForm({ ...form, outcome: "keep_credit", reason: "" });
                      setMode("cancel");
                    }}
                    disabled={!online}
                  >
                    Cancel the order
                  </Button>
                </>
              ) : null}
              <Button variant="link" onClick={() => setOrder(null)}>
                Other orders
              </Button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

/** The bill's customer for a collected order: from the till's list, else from the order. */
export function customerForOrder(order: TillOrder, snapshot: StoredSnapshot): DraftCustomer {
  const known = snapshot.customers.find((c) => c.id === order.customerId);
  return known
    ? { id: known.id, name: known.name, mobile: known.mobile, gstin: known.gstin, stateCode: known.stateCode, customerGroupId: known.customerGroupId }
    : { id: order.customerId, name: order.customer?.name ?? "Customer", mobile: order.customer?.mobile ?? null, gstin: null, stateCode: null, customerGroupId: null };
}

// ---- Alteration jobs ----

interface JobForm {
  name: string;
  phone: string;
  garment: string;
  work: string;
  tailorStaffId: string;
  tailorName: string;
  promisedOn: string;
  charge: string;
  chargePaidWith: "bill" | "collection";
}

export function AlterationsDialog({
  open,
  engine,
  snapshot,
  online,
  customer,
  today,
  onCharge,
  onClose,
}: {
  open: boolean;
  engine: TillEngine;
  snapshot: StoredSnapshot;
  online: boolean;
  customer: DraftCustomer | null;
  today: string;
  /** Puts the job's charge on this bill (and hands it back when `deliver`). */
  onCharge: (job: TillAlteration, deliver: boolean) => void;
  onClose: () => void;
}) {
  const staff = snapshot.salesStaff ?? [];
  const blank = (): JobForm => ({ name: customer?.name ?? "", phone: customer?.mobile ?? "", garment: "", work: "", tailorStaffId: "", tailorName: "", promisedOn: today, charge: "0", chargePaidWith: "collection" });
  const [tab, setTab] = useState<"jobs" | "new">("jobs");
  const [form, setForm] = useState<JobForm>(blank);
  const [rows, setRows] = useState<TillAlteration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const found = (await engine.api.findAlterations("open", snapshot.till.store.id)).rows;
      setRows(found);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // The dialog is mounted when it opens: the jobs in hand are loaded once.
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    engine.api.findAlterations("open", snapshot.till.store.id).then(
      (r) => !cancelled && setRows(r.rows),
      (err: unknown) => !cancelled && setError(errorMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [engine, online, snapshot.till.store.id]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const job = await engine.api.createAlteration({
        storeId: snapshot.till.store.id,
        customerId: customer?.id ?? null,
        name: form.name.trim() || null,
        phone: form.phone.trim() || null,
        tailorStaffId: form.tailorStaffId || null,
        tailorName: form.tailorStaffId ? null : form.tailorName.trim() || null,
        promisedOn: form.promisedOn,
        charge: form.charge.trim() || "0",
        chargePaidWith: form.chargePaidWith,
        lines: [{ garment: form.garment.trim(), work: form.work.trim() }],
      });
      // Paid with this bill: the charge goes on it now.
      if (job.chargePaidWith === "bill" && new Decimal(job.charge).gt(0)) onCharge(job, false);
      else {
        setTab("jobs");
        await load();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function move(job: TillAlteration, status: TillAlteration["status"]) {
    setError(null);
    try {
      await engine.api.alterationStatus(job.id, status);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} title="Alterations" onClose={onClose}>
      {!online ? <Alert kind="error">{NEEDS_CONNECTION}</Alert> : null}
      <Alert kind="error">{error}</Alert>
      <div className="till-row" role="tablist">
        <Button variant={tab === "jobs" ? "primary" : "secondary"} onClick={() => setTab("jobs")}>
          Jobs in hand
        </Button>
        <Button variant={tab === "new" ? "primary" : "secondary"} onClick={() => setTab("new")}>
          New job slip
        </Button>
      </div>
      {tab === "new" ? (
        <form onSubmit={create} aria-label="New alteration job">
          <div className="till-row">
            <input className="input" aria-label="Customer name" placeholder="Customer name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" aria-label="Phone" placeholder="Phone" inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="till-row">
            <input className="input" aria-label="Garment" placeholder="Garment (e.g. trouser)" value={form.garment} onChange={(e) => setForm({ ...form, garment: e.target.value })} />
            <input className="input" aria-label="Work" placeholder="Work (e.g. shorten 2 cm)" value={form.work} onChange={(e) => setForm({ ...form, work: e.target.value })} />
          </div>
          <div className="till-row">
            <select className="input" aria-label="Tailor" value={form.tailorStaffId} onChange={(e) => setForm({ ...form, tailorStaffId: e.target.value })}>
              <option value="">Tailor: type a name →</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
            {!form.tailorStaffId ? <input className="input" aria-label="Tailor name" placeholder="Tailor name" value={form.tailorName} onChange={(e) => setForm({ ...form, tailorName: e.target.value })} /> : null}
          </div>
          <div className="till-row">
            <label>
              Promised on <input className="input" type="date" aria-label="Promised on" value={form.promisedOn} min={today} onChange={(e) => setForm({ ...form, promisedOn: e.target.value })} />
            </label>
            <label>
              Charge ₹ <input className="input" aria-label="Charge" inputMode="decimal" value={form.charge} onChange={(e) => setForm({ ...form, charge: e.target.value })} />
            </label>
          </div>
          <div className="till-row" role="radiogroup" aria-label="Charge paid">
            <label>
              <input type="radio" name="paidWith" checked={form.chargePaidWith === "bill"} onChange={() => setForm({ ...form, chargePaidWith: "bill" })} /> With this bill
            </label>
            <label>
              <input type="radio" name="paidWith" checked={form.chargePaidWith === "collection"} onChange={() => setForm({ ...form, chargePaidWith: "collection" })} /> When collected
            </label>
          </div>
          <div className="actions">
            <Button type="submit" variant="primary" busy={busy} disabled={!online}>
              Save the job slip
            </Button>
          </div>
        </form>
      ) : (
        <>
          {rows && !rows.length ? <p className="muted">No alteration jobs in hand.</p> : null}
          <ul className="till-results" aria-label="Alteration jobs">
            {(rows ?? []).map((j) => {
              const unbilled = new Decimal(j.charge).gt(0) && !j.chargeBill;
              const next = NEXT[j.status];
              return (
                <li key={j.id} className="till-approval">
                  <span>
                    <span className="mono">{j.number}</span> {j.name} · {j.lines.map((l) => `${l.garment}: ${l.work}`).join("; ")} · {JOB_STATUS[j.status]} · due {j.promisedOn}
                    {j.overdue ? (
                      <>
                        {" "}
                        <Badge kind="warn">Overdue</Badge>
                      </>
                    ) : null}{" "}
                    · {rupees(j.charge)}
                    {j.chargeBill ? " (billed)" : ""}
                  </span>
                  <span className="row-actions">
                    {next ? (
                      <Button size="small" onClick={() => void move(j, next.status)}>
                        {next.label}
                      </Button>
                    ) : null}
                    {unbilled ? (
                      <Button size="small" variant="primary" onClick={() => onCharge(j, j.status === "ready")}>
                        {j.status === "ready" ? "Bill the charge and hand back" : "Bill the charge"}
                      </Button>
                    ) : j.status === "ready" ? (
                      <Button size="small" variant="primary" onClick={() => void move(j, "delivered")}>
                        Hand back
                      </Button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Dialog>
  );
}
