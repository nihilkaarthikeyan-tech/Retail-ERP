// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { createGoodsReceiptSchema, Decimal, updateGoodsReceiptSchema } from "shared";
import { PrintButton } from "@/components/documents/print-button";
import { PartyPicker } from "@/components/parties/party-picker";
import { StockItemAdder } from "@/components/stock/stock-item-adder";
import { SizeColourGrid } from "./size-colour-grid";
import { Alert, Button, CheckInput, SelectInput, TextareaInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useModules } from "@/lib/modules";
import { blankToNull } from "@/lib/format";
import { type GoodsReceiptDto, type PurchaseOrderDto, type PurchaseOrderHeader, purchaseRights } from "@/lib/purchasing";
import { defaultStoreId, storesFromLocations, useBusinessToday } from "@/lib/stock";
import type { ItemDto, PartyRef, StockLocationDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";
import { ReceiptsOrderPicker } from "./receipts-order-picker";
import { lineFromOrder, lineFromReceiptDto, lineWithoutOrder, ReceiptLineGrid, type ReceiptLineDraft, receiptLineProblem, receiptLineToInput } from "./receipts-lines";
import { ReasonDialog, ReceiptStatusBadge } from "./receipts-parts";
import { useUnsavedChanges } from "@/lib/unsaved";
import { confirmPosting } from "@/lib/confirm";

/** Shelf locations (not folders, transit or Rejected) of one store. */
export function shelvesOf(locations: StockLocationDto[], storeId: string): StockLocationDto[] {
  return locations.filter((l) => l.active && l.kind === "shelf" && l.store?.id === storeId);
}

async function loadItems(ids: string[]): Promise<Map<string, ItemDto>> {
  const unique = [...new Set(ids)];
  const items = await Promise.all(unique.map((id) => api.get<ItemDto>(`/items/${id}`)));
  return new Map(items.map((i) => [i.id, i]));
}

/** Open lines of an order for one store, as receipt lines (stock items with goods still expected). */
async function linesOfOrder(orderId: string, storeId: string | null): Promise<{ order: PurchaseOrderDto; lines: ReceiptLineDraft[]; otherStore: number }> {
  const order = await api.get<PurchaseOrderDto>(`/purchase/orders/${orderId}/open-lines`);
  const store = storeId ?? order.store.id;
  const open = order.lines.filter((l) => l.item.isStockItem && new Decimal(l.pendingQuantity).gt(0));
  const here = open.filter((l) => l.storeId === store);
  const items = await loadItems(here.map((l) => l.item.id));
  return { order, lines: here.flatMap((l) => (items.has(l.item.id) ? [lineFromOrder(l, order.number, items.get(l.item.id)!)] : [])), otherStore: open.length - here.length };
}

interface ReceiptEditorProps {
  /** The saved draft, or null for a new receipt. */
  receipt: GoodsReceiptDto | null;
  /** New receipt started from an order (?orderId=). */
  orderId?: string | null;
  locations: StockLocationDto[];
  /** After every save, finalise or cancel. */
  onSaved: (receipt: GoodsReceiptDto) => void;
}

interface Start {
  supplier: PartyRef | null;
  storeId: string | null;
  lines: ReceiptLineDraft[];
  note: string | null;
  orderIds: string[];
}

/** New goods receipt or a saved draft: loads the items (and the starting order) first. */
export function ReceiptEditor(props: ReceiptEditorProps) {
  const { receipt, orderId } = props;
  const start = useLoad<Start>(async () => {
    if (receipt) {
      const items = await loadItems(receipt.lines.map((l) => l.item.id));
      const lines = receipt.lines.flatMap((l) => (items.has(l.item.id) ? [lineFromReceiptDto(l, items.get(l.item.id)!)] : []));
      const orderIds = [...new Set(receipt.lines.flatMap((l) => (l.order ? [l.order.id] : [])))];
      return { supplier: receipt.supplier, storeId: receipt.store.id, lines, note: null, orderIds };
    }
    if (orderId) {
      const { order, lines, otherStore } = await linesOfOrder(orderId, null);
      const note =
        lines.length === 0
          ? `Order ${order.number} has nothing left to receive at ${order.store.code}.`
          : otherStore > 0
            ? `${otherStore} line${otherStore === 1 ? " is" : "s are"} for another store; receive them there.`
            : null;
      return { supplier: order.supplier, storeId: order.store.id, lines, note, orderIds: [order.id] };
    }
    return { supplier: null, storeId: null, lines: [], note: null, orderIds: [] };
  }, [receipt?.id, receipt?.status, orderId]);

  if (start.error) return <Alert kind="error">{`Could not load the receipt: ${start.error}`}</Alert>;
  if (!start.data) return <p className="muted">Loading…</p>;
  return <ReceiptForm key={receipt ? `${receipt.id}-${receipt.status}` : `new-${orderId ?? ""}`} {...props} start={start.data} />;
}

interface HeaderState {
  storeId: string;
  postingDate: string;
  deliveryNoteNo: string;
  transporterName: string;
  vehicleNo: string;
  noOrderReason: string;
  /** Plan 11 part 2: sale or return (owed only once sold). */
  isConsignment: boolean;
  remarks: string;
}

function ReceiptForm({ receipt, locations, onSaved, start }: ReceiptEditorProps & { start: Start }) {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const today = useBusinessToday();
  const stores = storesFromLocations(locations);
  const editable = rights.receive && (!receipt || receipt.status === "draft");

  const [supplier, setSupplier] = useState<PartyRef | null>(start.supplier);
  const [header, setHeader] = useState<HeaderState>(() => ({
    storeId: start.storeId ?? defaultStoreId(user, stores),
    postingDate: receipt?.postingDate ?? "",
    deliveryNoteNo: receipt?.deliveryNoteNo ?? "",
    transporterName: receipt?.transporterName ?? "",
    vehicleNo: receipt?.vehicleNo ?? "",
    noOrderReason: receipt?.noOrderReason ?? "",
    isConsignment: receipt?.isConsignment ?? false,
    remarks: receipt?.remarks ?? "",
  }));
  const [dateTouched, setDateTouched] = useState(false);
  const [lines, setLinesState] = useState<ReceiptLineDraft[]>(start.lines);
  const [orderIds, setOrderIds] = useState<string[]>(start.orderIds);
  const [addingOrder, setAddingOrder] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(start.note);
  const [dirty, setDirty] = useState(false);
  // Audit 9: asks before leaving with unsaved lines, and keeps the sign-in alive meanwhile.
  useUnsavedChanges(dirty);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "finalise" | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const shelves = header.storeId ? shelvesOf(locations, header.storeId) : [];
  // Plan 12: sale-or-return and purchase orders only while their modules are on.
  const { isOn } = useModules();
  const consignmentOn = isOn("consignment");
  const ordersOn = isOn("purchase_orders");
  const hasOrderLines = lines.some((l) => l.orderLineId);
  // Sale-or-return goods never come from an order, so no reason is asked for them; nor while
  // purchase orders are switched off (there is no order to receive against).
  const withoutOrder = lines.some((l) => !l.orderLineId) && !header.isConsignment && ordersOn;

  function set<K extends keyof HeaderState>(key: K, value: HeaderState[K]) {
    setHeader((h) => ({ ...h, [key]: value }));
    setDirty(true);
    setSaved(null);
    if (key === "postingDate") setDateTouched(true);
  }

  function setLines(next: ReceiptLineDraft[]) {
    setLinesState(next);
    setDirty(true);
    setSaved(null);
  }

  async function addOrder(order: PurchaseOrderHeader) {
    setAddingOrder(order.id);
    setNote(null);
    try {
      const { lines: more, otherStore } = await linesOfOrder(order.id, header.storeId);
      const fresh = more.filter((m) => !lines.some((l) => l.orderLineId === m.orderLineId));
      if (fresh.length === 0) setNote(`Order ${order.number} has nothing left to receive at this store.`);
      else if (otherStore > 0) setNote(`${otherStore} line${otherStore === 1 ? " is" : "s are"} of ${order.number} for another store; receive them there.`);
      setLines([...lines, ...fresh]);
      setOrderIds([...orderIds, order.id]);
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setAddingOrder(null);
    }
  }

  /** Checks everything locally; returns the body to send, or null (and shows why). */
  function prepare(): Record<string, unknown> | null {
    setError(null);
    const headerErrors: FieldErrors = {};
    if (!supplier) headerErrors.supplierId = "Choose the supplier";
    if (!header.storeId) headerErrors.storeId = "Choose the store";
    if (header.postingDate && today && header.postingDate > today) headerErrors.postingDate = "Goods cannot be received in the future";
    if (withoutOrder && !header.noOrderReason.trim()) headerErrors.noOrderReason = "Give the reason for receiving goods without a purchase order";

    const lineIssues: Record<string, string> = {};
    for (const l of lines) {
      const p = receiptLineProblem(l);
      if (p) lineIssues[l.key] = p;
    }
    setProblems(lineIssues);

    const sendDate = !receipt || dateTouched;
    const body = {
      supplierId: supplier?.id,
      storeId: header.storeId || undefined,
      postingDate: sendDate && header.postingDate ? header.postingDate : undefined,
      deliveryNoteNo: blankToNull(header.deliveryNoteNo),
      transporterName: blankToNull(header.transporterName),
      vehicleNo: blankToNull(header.vehicleNo),
      noOrderReason: withoutOrder ? blankToNull(header.noOrderReason) : null,
      isConsignment: header.isConsignment,
      remarks: blankToNull(header.remarks),
      lines: lines.map((l) => receiptLineToInput(l, rights.prices)),
    };
    const parsed = receipt ? updateGoodsReceiptSchema.safeParse(body) : createGoodsReceiptSchema.safeParse(body);
    const allErrors = { ...issuesToFieldErrors(parsed), ...headerErrors };
    setErrors(allErrors);

    if (lines.length === 0) {
      setError("Add at least one line.");
      return null;
    }
    if (Object.keys(lineIssues).length > 0) {
      setError(`Please fix the ${Object.keys(lineIssues).length === 1 ? "line" : "lines"} marked below: ${Object.values(lineIssues).join("; ")}`);
      return null;
    }
    if (Object.keys(headerErrors).length > 0 || !parsed.success) {
      setError("Please fix the fields marked below.");
      return null;
    }
    return parsed.data as Record<string, unknown>;
  }

  async function save() {
    const body = prepare();
    if (!body) return;
    setBusy("save");
    try {
      const after = receipt ? await api.patch<GoodsReceiptDto>(`/purchase/receipts/${receipt.id}`, body) : await api.post<GoodsReceiptDto>("/purchase/receipts", body);
      setDirty(false);
      setSaved("Draft saved.");
      onSaved(after);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function finalise() {
    if (!receipt) return;
    setBusy("finalise");
    try {
      if (dirty) {
        const body = prepare();
        if (!body) return;
        await api.patch<GoodsReceiptDto>(`/purchase/receipts/${receipt.id}`, body);
        setDirty(false);
      } else {
        setError(null);
      }
      const after = await api.post<GoodsReceiptDto>(`/purchase/receipts/${receipt.id}/finalise`);
      onSaved(after);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>{receipt ? `Goods receipt ${receipt.number}` : "Receive goods"}</h1>
        {receipt ? <ReceiptStatusBadge receipt={receipt} /> : null}
        <span className="spacer" />
        {receipt ? <PrintButton kind="goods_receipt" id={receipt.id} /> : null}
      </div>
      {!rights.receive ? <Alert kind="info">You can look at this draft but not change it.</Alert> : null}

      <div className="card">
        <div className="form-grid">
          <PartyPicker id="grn-supplier" label="Supplier" kind="supplier" value={supplier} onChange={(p) => { setSupplier(p); setDirty(true); }} error={errors.supplierId} disabled={!editable || hasOrderLines} hint={hasOrderLines ? "Fixed by the order lines below." : "Type part of the supplier's code or name."} />
          <SelectInput id="grn-store" label="Receiving store" value={header.storeId} onChange={(e) => set("storeId", e.target.value)} disabled={!editable || hasOrderLines} error={errors.storeId} required>
            <option value="">Choose…</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </SelectInput>
          <TextInput
            id="grn-date"
            label="Date received"
            type="date"
            value={header.postingDate || today}
            max={today || undefined}
            onChange={(e) => set("postingDate", e.target.value)}
            disabled={!editable}
            error={errors.postingDate}
            hint="Indian date. An earlier date than other movements of these items needs the Accountant."
          />
          <TextInput id="grn-dn" label="Supplier's delivery note no." value={header.deliveryNoteNo} onChange={(e) => set("deliveryNoteNo", e.target.value)} disabled={!editable} error={errors.deliveryNoteNo} maxLength={60} />
          <TextInput id="grn-transporter" label="Transporter" value={header.transporterName} onChange={(e) => set("transporterName", e.target.value)} disabled={!editable} error={errors.transporterName} maxLength={120} />
          <TextInput id="grn-vehicle" label="Vehicle no." value={header.vehicleNo} onChange={(e) => set("vehicleNo", e.target.value)} disabled={!editable} error={errors.vehicleNo} maxLength={30} />
        </div>
        <TextareaInput id="grn-remarks" label="Remarks" value={header.remarks} onChange={(e) => set("remarks", e.target.value)} disabled={!editable} error={errors.remarks} maxLength={500} />
        {consignmentOn || header.isConsignment ? (
        <CheckInput
          id="grn-consignment"
          label="Sale or return"
          description={
            hasOrderLines
              ? "Goods from a purchase order cannot be on sale or return."
              : "The supplier is paid only for what sells, through a consignment statement. Unsold goods can go back. They are not billed by a normal supplier bill."
          }
          checked={header.isConsignment}
          onChange={(e) => set("isConsignment", e.target.checked)}
          disabled={!editable || hasOrderLines || !consignmentOn}
        />
        ) : null}
      </div>

      {editable && supplier && !header.isConsignment && ordersOn ? (
        <>
          <h2>Orders waiting for goods</h2>
          <ReceiptsOrderPicker supplierId={supplier.id} usedOrderIds={orderIds} busyOrderId={addingOrder} onPick={addOrder} />
        </>
      ) : null}
      <Alert kind="info">{note}</Alert>

      <h2>Lines</h2>
      {editable && (rights.receiveWithoutOrder || header.isConsignment || !ordersOn) ? (
        <>
          <p className="muted">Goods that came without an order: scan or search for the item.</p>
          <StockItemAdder onAdd={(item, unitId) => setLines([...lines, lineWithoutOrder(item, unitId)])} />
          <SizeColourGrid onAdd={(more) => setLines([...lines, ...more.map((m) => ({ ...lineWithoutOrder(m.item, null), received: m.quantity }))])} />
        </>
      ) : null}
      <ReceiptLineGrid lines={lines} onChange={setLines} shelves={shelves} problems={problems} seesPrices={rights.prices} readOnly={!editable} />
      <p className="muted">
        Received is everything that arrived. Of that, rejected goods (damaged or wrong) go to the store&apos;s Rejected location at cost, ready to send back; free goods share the cost of
        the paid ones.{rights.prices ? " Leave the rate and GST blank to take them from the order or price list." : ""}
      </p>

      {withoutOrder ? (
        <div className="card">
          <p>Goods without a purchase order can be received only by a Store Manager, and the reason is kept in the history.</p>
          <TextareaInput
            id="grn-reason"
            label="Why is there no order?"
            value={header.noOrderReason}
            onChange={(e) => set("noOrderReason", e.target.value)}
            disabled={!editable}
            error={errors.noOrderReason}
            required
            maxLength={300}
          />
        </div>
      ) : null}

      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{saved}</Alert>
      <div className="actions">
        {editable ? (
          <Button variant={receipt ? "secondary" : "primary"} busy={busy === "save"} disabled={busy !== null} onClick={() => save()}>
            Save draft
          </Button>
        ) : null}
        {receipt && receipt.status === "draft" && rights.receive ? (
          <Button variant="primary" busy={busy === "finalise"} disabled={busy !== null} onClick={() => confirmPosting("Finalise this goods receipt", "The goods go into stock and what is owed to the supplier goes into the accounts now.") && finalise()}>
            Finalise
          </Button>
        ) : null}
        {receipt && receipt.status === "draft" && rights.receive ? (
          <Button variant="danger" disabled={busy !== null} onClick={() => setCancelOpen(true)}>
            Cancel draft
          </Button>
        ) : null}
        {!receipt ? (
          <Link href="/purchases/receipts" className="btn btn-secondary">
            Back to the list
          </Link>
        ) : null}
      </div>
      {!receipt ? <p className="muted">Save the draft first; then finalise it to put the goods into stock.</p> : null}
      {receipt ? (
        <ReasonDialog<GoodsReceiptDto>
          open={cancelOpen}
          title={`Cancel ${receipt.number}`}
          explanation="The draft is kept, marked as cancelled. Nothing in stock changes."
          path={`/purchase/receipts/${receipt.id}/cancel`}
          confirmLabel="Cancel the draft"
          danger
          onClose={() => setCancelOpen(false)}
          onDone={onSaved}
        />
      ) : null}
    </div>
  );
}
