// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { createPurchaseOrderSchema, updatePurchaseOrderSchema } from "shared";
import { PrintButton } from "@/components/documents/print-button";
import { PartyPicker } from "@/components/parties/party-picker";
import { Alert, Badge, Button, SelectInput, TextareaInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { blankToNull, formatDate } from "@/lib/format";
import { type PurchaseOrderDto, type PurchaseOrderStatus, purchaseRights, rupees } from "@/lib/purchasing";
import { defaultStoreId, showQuantity, useBusinessToday } from "@/lib/stock";
import type { ItemDto, PartyRef, PaymentTermsDto, StoreRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";
import { OrdersItemAdder } from "./orders-item-adder";
import { emptyOrderLine, OrderLineGrid, type OrderLineDraft, orderLineFromDto, orderLineProblem, orderLineToInput, previewOrderTotals } from "./orders-lines";
import { OrderStatusBadge, OrdersReasonDialog, useOrderStores } from "./orders-shared";

/** Finalised orders still expecting goods or a bill. */
const OPEN: PurchaseOrderStatus[] = ["to_receive_and_bill", "to_receive", "to_bill"];
/** Orders still expecting goods (a receipt can be made). */
const RECEIVABLE: PurchaseOrderStatus[] = ["to_receive_and_bill", "to_receive"];

interface OrdersEditorProps {
  /** The saved order, or null for a new one. */
  order: PurchaseOrderDto | null;
  /** After every successful save or action, with the server's answer. */
  onSaved: (order: PurchaseOrderDto) => void;
}

/** One editor for new and existing purchase orders: details, lines, preview, progress and actions. */
export function OrdersEditor({ order, onSaved }: OrdersEditorProps) {
  const { user } = useAuth();
  const cache = useRef(new Map<string, ItemDto>());
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const stores = useOrderStores();
  const terms = useLoad(() => api.get<PaymentTermsDto[]>("/payment-terms"));
  const itemIds = order ? [...new Set(order.lines.map((l) => l.item.id))] : [];
  const items = useLoad<ItemDto[]>(
    async () => {
      const missing = itemIds.filter((id) => !cache.current.has(id));
      const fetched = await Promise.all(missing.map((id) => api.get<ItemDto>(`/items/${id}`)));
      for (const item of fetched) cache.current.set(item.id, item);
      return itemIds.flatMap((id) => (cache.current.has(id) ? [cache.current.get(id)!] : []));
    },
    [order?.id, itemIds.join(",")],
  );

  if (items.error) return <Alert kind="error">{`Could not load the items of this order: ${items.error}`}</Alert>;
  // Wait for the user too: their stores decide the default store.
  if (!items.data || !user || stores.loading) return <p className="muted">Loading…</p>;
  const byId = new Map(items.data.map((i) => [i.id, i]));
  const lines = order ? order.lines.flatMap((l) => (byId.has(l.item.id) ? [orderLineFromDto(l, byId.get(l.item.id)!, order.neededBy)] : [])) : [];

  function saved(after: PurchaseOrderDto, message: string, used: ItemDto[]) {
    for (const item of used) cache.current.set(item.id, item);
    setNotice(message);
    setVersion((v) => v + 1);
    onSaved(after);
  }

  return (
    <>
      <Alert kind="error">{stores.error}</Alert>
      <OrderForm
        key={`${order?.id ?? "new"}-${version}`}
        order={order}
        initialLines={lines}
        stores={stores.stores}
        terms={(terms.data ?? []).filter((t) => t.active || t.id === order?.paymentTermsId)}
        notice={notice}
        onNotice={setNotice}
        onSaved={saved}
        onReset={() => {
          setNotice(null);
          setVersion((v) => v + 1);
        }}
      />
    </>
  );
}

interface HeaderState {
  supplier: PartyRef | null;
  storeId: string;
  orderDate: string;
  neededBy: string;
  supplierQuoteRef: string;
  paymentTermsId: string;
  remarks: string;
}

interface OrderFormProps {
  order: PurchaseOrderDto | null;
  initialLines: OrderLineDraft[];
  stores: StoreRef[];
  terms: PaymentTermsDto[];
  notice: string | null;
  onNotice: (message: string | null) => void;
  onSaved: (order: PurchaseOrderDto, message: string, items: ItemDto[]) => void;
  /** Throws away unsaved changes (starts the form again from the saved order). */
  onReset: () => void;
}

type Busy = "save" | "finalise" | "release" | "reopen" | null;
type ReasonAction = "hold" | "close" | "cancel" | null;

function OrderForm({ order, initialLines, stores, terms, notice, onNotice, onSaved, onReset }: OrderFormProps) {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const today = useBusinessToday();
  const status = order?.status ?? "draft";
  const isDraft = !order || status === "draft";
  const changeable = !!order && (OPEN.includes(status) || status === "on_hold");

  const [changing, setChanging] = useState(false);
  const editable = rights.order && (isDraft || (changeable && changing));
  const [header, setHeader] = useState<HeaderState>(() => ({
    supplier: order ? order.supplier : null,
    storeId: order?.store.id ?? defaultStoreId(user, stores),
    orderDate: order?.orderDate ?? "",
    neededBy: order?.neededBy ?? "",
    supplierQuoteRef: order?.supplierQuoteRef ?? "",
    paymentTermsId: order?.paymentTermsId ?? "",
    remarks: order?.remarks ?? "",
  }));
  const [lines, setLinesState] = useState<OrderLineDraft[]>(initialLines);
  const [linesDirty, setLinesDirty] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [reasonFor, setReasonFor] = useState<ReasonAction>(null);

  function set<K extends keyof HeaderState>(key: K, value: HeaderState[K]) {
    setHeader((h) => ({ ...h, [key]: value }));
    setDirty(true);
    onNotice(null);
  }

  function setLines(next: OrderLineDraft[]) {
    setLinesState(next);
    setLinesDirty(true);
    setDirty(true);
    onNotice(null);
  }

  /** Checks everything locally; returns the body to send, or null (and shows why). */
  function prepare(): Record<string, unknown> | null {
    setError(null);
    const headerErrors: FieldErrors = {};
    if (!header.supplier) headerErrors.supplierId = "Choose the supplier";
    if (!header.storeId) headerErrors.storeId = "Choose the store";
    if (!header.neededBy) headerErrors.neededBy = "Choose the date the goods are needed by";
    const orderDate = header.orderDate || today;
    if (orderDate && today && orderDate > today) headerErrors.orderDate = "An order cannot be dated in the future";
    if (orderDate && header.neededBy && header.neededBy < orderDate) headerErrors.neededBy = "The date needed cannot be before the order date";
    if (order && !isDraft && !changeReason.trim()) headerErrors.changeReason = "Say why the order is being changed";

    const lineIssues: Record<string, string> = {};
    for (const l of lines) {
      const p = orderLineProblem(l, rights.prices);
      if (p) lineIssues[l.key] = p;
    }
    setProblems(lineIssues);

    // Lines are sent only when they changed, so a save of the details alone never re-prices them.
    const sendLines = !order || linesDirty;
    const body = {
      ...(isDraft ? { supplierId: header.supplier?.id } : {}),
      ...(orderDate ? { orderDate } : {}),
      neededBy: header.neededBy,
      storeId: header.storeId,
      supplierQuoteRef: blankToNull(header.supplierQuoteRef),
      paymentTermsId: header.paymentTermsId || null,
      remarks: blankToNull(header.remarks),
      ...(sendLines ? { lines: lines.map((l) => orderLineToInput(l, rights.prices)) } : {}),
      ...(order && !isDraft ? { changeReason: changeReason.trim() } : {}),
    };
    const parsed = order ? updatePurchaseOrderSchema.safeParse(body) : createPurchaseOrderSchema.safeParse(body);
    const allErrors = { ...issuesToFieldErrors(parsed), ...headerErrors };
    setErrors(allErrors);

    if (lines.length === 0) {
      setError("Add at least one item.");
      return null;
    }
    if (Object.keys(lineIssues).length > 0) {
      setError(`Please fix the ${Object.keys(lineIssues).length === 1 ? "line" : "lines"} marked below: ${Object.values(lineIssues).join("; ")}`);
      return null;
    }
    if (Object.keys(allErrors).length > 0 || !parsed.success) {
      setError("Please fix the fields marked below.");
      return null;
    }
    return parsed.data as Record<string, unknown>;
  }

  const usedItems = () => lines.map((l) => l.item);

  async function save() {
    const body = prepare();
    if (!body) return;
    setBusy("save");
    try {
      const after = order ? await api.patch<PurchaseOrderDto>(`/purchase/orders/${order.id}`, body) : await api.post<PurchaseOrderDto>("/purchase/orders", body);
      onSaved(after, isDraft ? "Draft saved." : "Changes saved. The figures below are the server's.", usedItems());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function finalise() {
    if (!order) return;
    setBusy("finalise");
    try {
      if (dirty && editable) {
        const body = prepare();
        if (!body) return;
        await api.patch<PurchaseOrderDto>(`/purchase/orders/${order.id}`, body);
      } else {
        setError(null);
      }
      const after = await api.post<PurchaseOrderDto>(`/purchase/orders/${order.id}/finalise`);
      onSaved(after, "Order finalised. It now counts as on order.", usedItems());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function simple(action: "release" | "reopen", message: string) {
    if (!order) return;
    setBusy(action);
    setError(null);
    try {
      const after = await api.post<PurchaseOrderDto>(`/purchase/orders/${order.id}/${action}`);
      onSaved(after, message, usedItems());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function withReason(action: "hold" | "close" | "cancel", reason: string) {
    if (!order) return;
    const after = await api.post<PurchaseOrderDto>(`/purchase/orders/${order.id}/${action}`, { reason });
    const messages = { hold: "Order put on hold.", close: "Order closed. The rest is no longer expected.", cancel: "Order cancelled." };
    onSaved(after, messages[action], usedItems());
  }

  const preview = rights.prices && (dirty || !order) && lines.length > 0 ? previewOrderTotals(lines) : null;
  const withProgress = !!order && !isDraft;
  const title = order ? `Purchase order ${order.number}` : "New purchase order";

  const can = {
    save: editable,
    finalise: !!order && isDraft && rights.order,
    change: changeable && rights.order && !changing,
    hold: !!order && OPEN.includes(status) && rights.approve && !changing,
    release: !!order && status === "on_hold" && rights.approve && !changing,
    close: !!order && (OPEN.includes(status) || status === "on_hold") && rights.approve && !changing,
    reopen: !!order && status === "closed" && rights.approve,
    cancel: !!order && status !== "cancelled" && status !== "completed" && rights.order && !changing,
    receive: !!order && RECEIVABLE.includes(status) && rights.receive && !changing,
  };

  const reasonDialogs = {
    hold: { title: `Put ${order?.number ?? ""} on hold`, explain: "No goods or bills can be taken against the order until it is released.", confirm: "Put on hold", danger: false },
    close: { title: `Close ${order?.number ?? ""}`, explain: "The rest of the order is no longer expected. What was received and billed stays. It can be reopened later.", confirm: "Close the order", danger: false },
    cancel: {
      title: `Cancel ${order?.number ?? ""}`,
      explain: "The order stays visible, marked as cancelled. This is refused while goods receipts or supplier bills refer to it; close the order instead.",
      confirm: "Cancel the order",
      danger: true,
    },
  };

  return (
    <div>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>{title}</h1>
        {order ? <OrderStatusBadge status={order.status} /> : null}
        {order?.overdue ? <Badge kind="off">Overdue</Badge> : null}
        <span className="spacer" />
        {order ? <PrintButton kind="purchase_order" id={order.id} /> : null}
      </div>
      {!rights.order && isDraft ? <Alert kind="info">You can look at this order but not change it.</Alert> : null}
      {changing ? <Alert kind="info">You are changing a finalised order. Every figure is worked out again and the change is logged with your reason.</Alert> : null}

      <div className="card">
        <div className="form-grid">
          <div className="span-2">
            <PartyPicker
              id="order-supplier"
              label="Supplier"
              kind="supplier"
              value={header.supplier}
              onChange={(p) => set("supplier", p)}
              disabled={!editable || !isDraft}
              error={errors.supplierId}
              hint={editable && isDraft ? "Type part of the supplier's code, name or mobile. A supplier on hold cannot get an order." : undefined}
            />
          </div>
          <SelectInput id="order-store" label="Store" value={header.storeId} onChange={(e) => set("storeId", e.target.value)} disabled={!editable} error={errors.storeId} required>
            <option value="">Choose…</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
            {order && !stores.some((s) => s.id === order.store.id) ? (
              <option value={order.store.id}>
                {order.store.code} — {order.store.name}
              </option>
            ) : null}
          </SelectInput>
          <TextInput
            id="order-date"
            label="Order date"
            type="date"
            value={header.orderDate || today}
            max={today || undefined}
            onChange={(e) => set("orderDate", e.target.value)}
            disabled={!editable}
            error={errors.orderDate}
            hint="Indian date."
          />
          <TextInput id="order-needed-by" label="Needed by" type="date" value={header.neededBy} min={header.orderDate || today || undefined} onChange={(e) => set("neededBy", e.target.value)} disabled={!editable} error={errors.neededBy} required />
          <TextInput
            id="order-quote-ref"
            label="Supplier's quotation ref."
            value={header.supplierQuoteRef}
            onChange={(e) => set("supplierQuoteRef", e.target.value)}
            disabled={!editable}
            error={errors.supplierQuoteRef}
            maxLength={60}
          />
          {terms.length > 0 ? (
            <SelectInput id="order-terms" label="Payment terms" value={header.paymentTermsId} onChange={(e) => set("paymentTermsId", e.target.value)} disabled={!editable} error={errors.paymentTermsId} hint="Blank: the supplier's usual terms.">
              <option value="">Supplier&apos;s usual terms</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectInput>
          ) : null}
        </div>
        <TextareaInput id="order-remarks" label="Remarks" value={header.remarks} onChange={(e) => set("remarks", e.target.value)} disabled={!editable} error={errors.remarks} maxLength={500} />
      </div>

      {order && !isDraft ? <OrderProgress order={order} /> : null}

      <h2>Lines</h2>
      {editable ? <OrdersItemAdder onAdd={(item, unitId) => setLines([...lines, emptyOrderLine(item, unitId)])} /> : null}
      <OrderLineGrid lines={lines} onChange={setLines} problems={problems} withPrices={rights.prices} withProgress={withProgress} readOnly={!editable} />
      {editable && rights.prices ? <p className="muted">Rate is per the unit chosen on the line, before GST. Leave the rate blank to use the supplier&apos;s price list or the last purchase price.</p> : null}
      {editable && !rights.prices ? <p className="muted">Prices are filled in by the server from the supplier&apos;s price list or the last purchase price.</p> : null}

      {rights.prices ? <OrderTotals order={order} preview={preview} /> : null}

      {editable && order && !isDraft ? (
        <TextInput id="order-change-reason" label="Why is the order being changed?" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} error={errors.changeReason} maxLength={300} required />
      ) : null}

      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{notice}</Alert>
      <div className="actions">
        {can.save ? (
          <Button variant={order ? "secondary" : "primary"} busy={busy === "save"} disabled={busy !== null} onClick={save}>
            {isDraft ? "Save draft" : "Save changes"}
          </Button>
        ) : null}
        {can.finalise ? (
          <Button variant="primary" busy={busy === "finalise"} disabled={busy !== null} onClick={finalise}>
            Finalise
          </Button>
        ) : null}
        {changing ? (
          <Button disabled={busy !== null} onClick={onReset}>
            Stop changing
          </Button>
        ) : null}
        {can.change ? (
          <Button disabled={busy !== null} onClick={() => setChanging(true)}>
            Change order
          </Button>
        ) : null}
        {can.receive ? (
          <Link href={`/purchases/receipts/new?orderId=${order!.id}`} className="btn btn-primary">
            Receive goods
          </Link>
        ) : null}
        {can.hold ? (
          <Button disabled={busy !== null} onClick={() => setReasonFor("hold")}>
            Hold
          </Button>
        ) : null}
        {can.release ? (
          <Button busy={busy === "release"} disabled={busy !== null} onClick={() => simple("release", "Order released.")}>
            Release
          </Button>
        ) : null}
        {can.close ? (
          <Button disabled={busy !== null} onClick={() => setReasonFor("close")}>
            Close
          </Button>
        ) : null}
        {can.reopen ? (
          <Button busy={busy === "reopen"} disabled={busy !== null} onClick={() => simple("reopen", "Order reopened.")}>
            Reopen
          </Button>
        ) : null}
        {can.cancel ? (
          <Button variant="danger" disabled={busy !== null} onClick={() => setReasonFor("cancel")}>
            Cancel order
          </Button>
        ) : null}
      </div>
      {!order ? <p className="muted">Save the draft first; it can then be finalised.</p> : null}
      {reasonFor ? (
        <OrdersReasonDialog
          open
          title={reasonDialogs[reasonFor].title}
          explain={reasonDialogs[reasonFor].explain}
          confirmLabel={reasonDialogs[reasonFor].confirm}
          danger={reasonDialogs[reasonFor].danger}
          onClose={() => setReasonFor(null)}
          onConfirm={(reason) => withReason(reasonFor, reason)}
        />
      ) : null}
    </div>
  );
}

/** Received and billed progress, due date, approval and the reasons given for hold, close or cancel. */
function OrderProgress({ order }: { order: PurchaseOrderDto }) {
  return (
    <div className="card">
      <dl className="kv">
        <dt>Received</dt>
        <dd>
          <progress max={100} value={Number(order.receivedPercent)} aria-label="Received percent" /> {showQuantity(order.receivedPercent)}%
        </dd>
        <dt>Billed</dt>
        <dd>
          <progress max={100} value={Number(order.billedPercent)} aria-label="Billed percent" /> {showQuantity(order.billedPercent)}%
        </dd>
        {order.dueDate ? (
          <>
            <dt>Payment due</dt>
            <dd>{formatDate(order.dueDate)}</dd>
          </>
        ) : null}
        {order.approvedAboveLimit ? (
          <>
            <dt>Approval</dt>
            <dd>Approved above the order limit.</dd>
          </>
        ) : null}
        {order.holdReason && order.status === "on_hold" ? (
          <>
            <dt>On hold because</dt>
            <dd>{order.holdReason}</dd>
          </>
        ) : null}
        {order.closeReason && order.status === "closed" ? (
          <>
            <dt>Closed because</dt>
            <dd>{order.closeReason}</dd>
          </>
        ) : null}
        {order.cancelReason ? (
          <>
            <dt>Cancelled because</dt>
            <dd>{order.cancelReason}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

/** The server's totals for the saved order, and a clearly marked estimate while there are unsaved changes. */
function OrderTotals({ order, preview }: { order: PurchaseOrderDto | null; preview: ReturnType<typeof previewOrderTotals> | null }) {
  if (order?.total === undefined && !preview) return null;
  return (
    <div className="card">
      {order?.total !== undefined ? (
        <>
          <h2 style={{ marginTop: 0 }}>Order total</h2>
          <dl className="kv">
            <dt>Taxable value</dt>
            <dd>{rupees(order.taxableAmount)}</dd>
            <dt>GST</dt>
            <dd>{rupees(order.taxAmount)}</dd>
            <dt>Rounding</dt>
            <dd>{rupees(order.roundingAdjustment)}</dd>
            <dt>Total</dt>
            <dd>
              <strong>{rupees(order.total)}</strong>
            </dd>
          </dl>
        </>
      ) : null}
      {preview ? (
        <div aria-label="Estimate of your changes">
          <p className="muted">
            {order ? "Estimate with your unsaved changes" : "Estimate"} (the server works out the final figures when you save): taxable {rupees(preview.taxable.toFixed(2))}, GST{" "}
            {rupees(preview.tax.toFixed(2))}, total <strong>{rupees(preview.total.toFixed(2))}</strong>.
            {preview.missing > 0 ? ` ${preview.missing} line${preview.missing === 1 ? " has" : "s have"} no rate typed and will be priced by the server.` : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}
