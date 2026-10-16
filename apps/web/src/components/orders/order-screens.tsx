// Copyright (c) 2026, Rademics. All rights reserved.
// Customer orders in the back office (plan 11 part 2 §1): the list with its
// views (open, ready, overdue, collected, cancelled, advances held), a new or
// changed order, and one order with its lines, advances and actions: mark
// ready (goods set aside), take an advance into a cash or bank account, cancel
// keeping the advance as credit, and print the order slip. Advances at the
// till and refunds (manager PIN) are taken on the till.
"use client";

import Link from "next/link";
import { useState } from "react";
import { CUSTOMER_ORDER_STATUS_LABELS, type CustomerOrderView, customerOrderSchema, Decimal } from "shared";
import { PrintButton } from "@/components/documents/print-button";
import { PartyPicker } from "@/components/parties/party-picker";
import { ItemPicker } from "@/components/prices/item-picker";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert, Badge, Button, type Column, DataTable, Dialog, SelectInput, TextInput, TextareaInput } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { ORDER_STATUS_TONE, type OrderDto } from "@/lib/orders";
import { rupees } from "@/lib/purchasing";
import { storesFromLocations } from "@/lib/stock";
import type { ItemDto, PartyRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

const VIEWS: { key: CustomerOrderView | ""; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "ready", label: "Ready" },
  { key: "overdue", label: "Overdue" },
  { key: "advances", label: "Advances held" },
  { key: "collected", label: "Collected" },
  { key: "cancelled", label: "Cancelled" },
  { key: "", label: "All" },
];

interface Page {
  rows: OrderDto[];
  total: number;
  advancesHeld?: string;
}

export function OrdersScreen() {
  const locations = useStockLocations();
  const stores = storesFromLocations(locations.data ?? []);
  const [view, setView] = useState<CustomerOrderView | "">("open");
  const [storeId, setStoreId] = useState("");
  const [search, setSearch] = useState("");
  const list = useLoad(() => api.get<Page>(`/orders${query({ view: view || undefined, storeId: storeId || undefined, search: search.trim() || undefined, pageSize: "200" })}`), [view, storeId, search]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrderDto | "new" | null>(null);

  const columns: Column<OrderDto>[] = [
    {
      key: "number",
      header: "Order",
      render: (r) => (
        <Button variant="link" onClick={() => setOpenId(r.id)}>
          <span className="mono">{r.number}</span>
        </Button>
      ),
    },
    { key: "customer", header: "Customer", render: (r) => (r.customer ? `${r.customer.name}${r.customer.mobile ? ` · ${r.customer.mobile}` : ""}` : "—") },
    { key: "store", header: "Store", render: (r) => r.store?.code ?? "—" },
    { key: "expected", header: "Expected", render: (r) => (r.expectedOn ? <>{formatDate(r.expectedOn)} {r.overdue ? <Badge kind="warn">Overdue</Badge> : null}</> : "—") },
    { key: "total", header: "Total", align: "right", render: (r) => rupees(r.total) },
    { key: "advance", header: "Advance held", align: "right", render: (r) => rupees(r.advanceHeld) },
    { key: "status", header: "Status", render: (r) => <Badge kind={ORDER_STATUS_TONE[r.status]}>{CUSTOMER_ORDER_STATUS_LABELS[r.status]}</Badge> },
  ];

  return (
    <>
      <h1>Customer orders</h1>
      <p className="muted">Goods a customer orders and collects later, usually with an advance. The advance shows as a credit on the customer&apos;s balance; it pays part of the till bill when the order is collected.</p>
      <div className="filter-row">
        <SelectInput id="ord-view" label="Show" value={view} onChange={(e) => setView(e.target.value as CustomerOrderView | "")}>
          {VIEWS.map((v) => (
            <option key={v.key} value={v.key}>
              {v.label}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="ord-store" label="Store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">All my stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
        <TextInput id="ord-search" label="Search" placeholder="Number, customer or mobile" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button variant="primary" onClick={() => setEditing("new")}>
          New order
        </Button>
      </div>
      {list.data?.advancesHeld ? (
        <p data-testid="advances-held">
          Advances held for open and ready orders: <strong>{rupees(list.data.advancesHeld)}</strong>
        </p>
      ) : null}
      <Alert kind="error">{list.error}</Alert>
      <DataTable columns={columns} rows={list.data?.rows ?? null} rowKey={(r) => r.id} loading={list.loading} empty="No orders." />
      {editing ? (
        <OrderEditor
          order={editing === "new" ? null : editing}
          stores={stores}
          onClose={() => setEditing(null)}
          onSaved={(o) => {
            setEditing(null);
            setOpenId(o.id);
            void list.reload();
          }}
        />
      ) : null}
      {openId && !editing ? (
        <OrderPanel
          id={openId}
          onClose={() => setOpenId(null)}
          onEdit={(o) => setEditing(o)}
          onChanged={() => void list.reload()}
        />
      ) : null}
    </>
  );
}

interface EditLine {
  item: ItemDto | { id: string; code: string; name: string } | null;
  quantity: string;
  price: string;
  remarks: string;
}

export function OrderEditor({ order, stores, onClose, onSaved }: { order: OrderDto | null; stores: { id: string; code: string; name: string }[]; onClose: () => void; onSaved: (o: OrderDto) => void }) {
  const [storeId, setStoreId] = useState(order?.storeId ?? stores[0]?.id ?? "");
  const [customer, setCustomer] = useState<PartyRef | null>(order?.customer ? { id: order.customer.id, code: order.customer.code, name: order.customer.name } : null);
  const [expectedOn, setExpectedOn] = useState(order?.expectedOn ?? "");
  const [remarks, setRemarks] = useState(order?.remarks ?? "");
  const [lines, setLines] = useState<EditLine[]>(order?.lines?.map((l) => ({ item: l.item, quantity: l.quantity, price: l.price, remarks: l.remarks ?? "" })) ?? [{ item: null, quantity: "1", price: "", remarks: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = lines.reduce((s, l) => {
    try {
      return s.add(new Decimal(l.quantity || "0").mul(new Decimal(l.price || "0")).toDecimalPlaces(2));
    } catch {
      return s;
    }
  }, new Decimal(0));

  async function save() {
    setError(null);
    const body = {
      storeId: storeId || (stores.length === 1 ? stores[0].id : ""),
      customerId: customer?.id ?? "",
      expectedOn: expectedOn || null,
      remarks: remarks.trim() || null,
      lines: lines.filter((l) => l.item).map((l) => ({ itemId: l.item!.id, quantity: l.quantity.trim(), price: l.price.trim(), remarks: l.remarks.trim() || null })),
    };
    const parsed = customerOrderSchema.safeParse(body);
    if (!parsed.success) return setError(!body.customerId ? "Choose the customer" : (parsed.error.issues[0]?.message ?? "Check the order"));
    setBusy(true);
    try {
      onSaved(order ? await api.patch<OrderDto>(`/orders/${order.id}`, parsed.data) : await api.post<OrderDto>("/orders", parsed.data));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const patch = (i: number, p: Partial<EditLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));

  return (
    <Dialog open title={order ? `Change order ${order.number}` : "New customer order"} onClose={onClose}>
      <Alert kind="error">{error}</Alert>
      <SelectInput id="ord-ed-store" label="Store" value={storeId} disabled={!!order} onChange={(e) => setStoreId(e.target.value)}>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} — {s.name}
          </option>
        ))}
      </SelectInput>
      <PartyPicker id="ord-ed-customer" label="Customer (named, not walk-in)" kind="customer" value={customer} onChange={setCustomer} />
      <TextInput id="ord-ed-expected" label="Expected on" type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} />
      <table className="table" aria-label="Ordered items">
        <thead>
          <tr>
            <th>Item</th>
            <th>Quantity</th>
            <th>Agreed price (GST incl.)</th>
            <th>Note</th>
            <th>
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                {l.item ? (
                  <>
                    <span className="mono">{l.item.code}</span> {l.item.name}{" "}
                    <Button size="small" variant="link" onClick={() => patch(i, { item: null })}>
                      Change
                    </Button>
                  </>
                ) : (
                  <ItemPicker id={`ord-ed-item-${i}`} label={`Item ${i + 1}`} value={null} onChange={(item) => item && patch(i, { item })} />
                )}
              </td>
              <td>
                <input className="input" aria-label={`Quantity ${i + 1}`} inputMode="decimal" value={l.quantity} onChange={(e) => patch(i, { quantity: e.target.value })} />
              </td>
              <td>
                <input className="input" aria-label={`Agreed price ${i + 1}`} inputMode="decimal" value={l.price} onChange={(e) => patch(i, { price: e.target.value })} />
              </td>
              <td>
                <input className="input" aria-label={`Note ${i + 1}`} placeholder="Size, colour…" value={l.remarks} onChange={(e) => patch(i, { remarks: e.target.value })} />
              </td>
              <td>
                <Button variant="link" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                  ✕
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <Button size="small" onClick={() => setLines([...lines, { item: null, quantity: "1", price: "", remarks: "" }])}>
          Add an item
        </Button>{" "}
        Total <strong data-testid="order-total">{rupees(total.toFixed(2))}</strong>
      </p>
      <TextareaInput id="ord-ed-remarks" label="Remarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          {order ? "Save changes" : "Take the order"}
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

interface CashBankAccount {
  id: string;
  number: string | null;
  name: string;
  kind: string;
  isGroup: boolean;
  active: boolean;
  storeId: string | null;
}

function OrderPanel({ id, onClose, onEdit, onChanged }: { id: string; onClose: () => void; onEdit: (o: OrderDto) => void; onChanged: () => void }) {
  const order = useLoad(() => api.get<OrderDto>(`/orders/${id}`), [id]);
  const [acting, setActing] = useState<"advance" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const o = order.data;

  async function run(fn: () => Promise<OrderDto>) {
    setError(null);
    setBusy(true);
    try {
      order.setData(await fn());
      setActing(null);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open title={o ? `Order ${o.number}` : "Order"} onClose={onClose}>
      <Alert kind="error">{order.error ?? error}</Alert>
      {!o ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <p>
            <strong>{o.customer?.name}</strong> {o.customer?.mobile ? <span className="muted">{o.customer.mobile}</span> : null} · {o.store?.code} · <Badge kind={ORDER_STATUS_TONE[o.status]}>{CUSTOMER_ORDER_STATUS_LABELS[o.status]}</Badge>
            {o.expectedOn ? ` · expected ${formatDate(o.expectedOn)}` : ""} {o.overdue ? <Badge kind="warn">Overdue</Badge> : null}
          </p>
          {o.collectedBill ? (
            <p>
              Collected on bill <Link href={`/pos/bills/${o.collectedBill.id}`} className="mono">{o.collectedBill.number}</Link>
            </p>
          ) : null}
          {o.status === "cancelled" ? <p className="muted">Cancelled: {o.cancelReason} {o.advanceOutcome === "refund" ? "(advance refunded)" : o.advanceOutcome === "keep_credit" ? "(advance kept as the customer's credit)" : ""}</p> : null}
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Quantity</th>
                <th className="num">Agreed price</th>
                <th className="num">Amount</th>
                <th className="num">Set aside</th>
              </tr>
            </thead>
            <tbody>
              {(o.lines ?? []).map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.item.name} <span className="muted mono">{l.item.code}</span>
                    {l.remarks ? <div className="muted">{l.remarks}</div> : null}
                  </td>
                  <td className="num">
                    {l.quantity} {l.unitCode}
                  </td>
                  <td className="num">{rupees(l.price)}</td>
                  <td className="num">{rupees(l.amount)}</td>
                  <td className="num">{l.setAside}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p data-testid="order-money">
            Total {rupees(o.total)} · advance received {rupees(o.advanceReceived)}
            {new Decimal(o.advanceRefunded).gt(0) ? ` · refunded ${rupees(o.advanceRefunded)}` : ""} · held <strong>{rupees(o.advanceHeld)}</strong>
          </p>
          {o.payments?.length ? (
            <ul aria-label="Advances">
              {o.payments.map((p) => (
                <li key={p.id}>
                  <span className="mono">{p.number}</span> {p.date ? formatDate(p.date) : ""} · {p.kind === "receipt" ? "advance" : "refund"} {rupees(p.amount)}
                  {p.reference ? ` · ${p.reference}` : ""}
                  {p.unused !== null ? ` · unused ${rupees(p.unused)}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {acting === "advance" ? <AdvanceForm busy={busy} storeId={o.storeId} onCancel={() => setActing(null)} onSave={(body) => void run(() => api.post<OrderDto>(`/orders/${o.id}/advances`, body))} /> : null}
          {acting === "cancel" ? <CancelForm busy={busy} held={o.advanceHeld} onCancel={() => setActing(null)} onSave={(reason) => void run(() => api.post<OrderDto>(`/orders/${o.id}/cancel`, { reason }))} /> : null}
          {!acting ? (
            <div className="actions">
              {o.status === "open" ? (
                <>
                  <Button variant="primary" busy={busy} onClick={() => void run(() => api.post<OrderDto>(`/orders/${o.id}/ready`))}>
                    Goods arrived: mark ready
                  </Button>
                  <Button onClick={() => onEdit(o)}>Change</Button>
                </>
              ) : null}
              {o.status === "open" || o.status === "ready" ? (
                <>
                  <Button onClick={() => setActing("advance")}>Take an advance</Button>
                  <Button variant="danger" onClick={() => setActing("cancel")}>
                    Cancel the order
                  </Button>
                </>
              ) : null}
              <PrintButton kind="customer_order" id={o.id} label="Print the order slip" />
            </div>
          ) : null}
          <p className="muted">To refund an advance, cancel the order at the till: a manager approves it with a PIN.</p>
        </>
      )}
    </Dialog>
  );
}

function AdvanceForm({ busy, storeId, onSave, onCancel }: { busy: boolean; storeId: string; onSave: (body: Record<string, unknown>) => void; onCancel: () => void }) {
  const accounts = useLoad(() => api.get<{ accounts: CashBankAccount[] }>("/accounts").then((r) => r.accounts.filter((a) => !a.isGroup && a.active && (a.kind === "bank" || (a.kind === "cash" && (!a.storeId || a.storeId === storeId))))));
  const [form, setForm] = useState({ accountId: "", amount: "", reference: "", referenceDate: "" });
  const bank = accounts.data?.find((a) => a.id === form.accountId)?.kind === "bank";
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Take an advance</h3>
      {accounts.error ? <Alert kind="info">Your account list is not open to you; take the advance at the till instead.</Alert> : null}
      <SelectInput id="adv-account" label="Into" value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
        <option value="">Choose cash or bank…</option>
        {(accounts.data ?? []).map((a) => (
          <option key={a.id} value={a.id}>
            {a.number ? `${a.number} ` : ""}
            {a.name}
          </option>
        ))}
      </SelectInput>
      <TextInput id="adv-amount" label="Amount (₹)" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
      {bank ? (
        <>
          <TextInput id="adv-ref" label="Cheque or transfer number" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          <TextInput id="adv-ref-date" label="Its date" type="date" value={form.referenceDate} onChange={(e) => setForm({ ...form, referenceDate: e.target.value })} />
        </>
      ) : null}
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={() => onSave({ accountId: form.accountId, amount: form.amount.trim(), reference: form.reference.trim() || null, referenceDate: form.referenceDate || null })}>
          Record the advance
        </Button>
        <Button onClick={onCancel}>Back</Button>
      </div>
    </div>
  );
}

function CancelForm({ busy, held, onSave, onCancel }: { busy: boolean; held: string; onSave: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Cancel the order</h3>
      {new Decimal(held).gt(0) ? <p>The advance of {rupees(held)} stays as the customer&apos;s credit for the next bill.</p> : null}
      <TextareaInput id="ord-cancel-reason" label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="actions">
        <Button variant="danger" busy={busy} disabled={!reason.trim()} onClick={() => onSave(reason.trim())}>
          Cancel the order
        </Button>
        <Button onClick={onCancel}>Back</Button>
      </div>
    </div>
  );
}
