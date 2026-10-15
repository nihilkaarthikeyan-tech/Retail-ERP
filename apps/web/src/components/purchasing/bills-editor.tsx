// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState } from "react";
import { PartyPicker } from "@/components/parties/party-picker";
import { StockItemAdder } from "@/components/stock/stock-item-adder";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert, Button, SelectInput, TextareaInput, TextInput } from "@/components/ui";
import { api, ApiError, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { blankToNull, formatDate } from "@/lib/format";
import { BILL_KIND_LABELS, type GoodsReceiptDto, type GoodsReceiptHeader, type Page, purchaseRights, RECEIPT_STATUS_LABELS, rupees, type SupplierBillDto } from "@/lib/purchasing";
import { defaultStoreId, stockLocationsOf, storesFromLocations, useBusinessToday } from "@/lib/stock";
import type { ItemDto, ItemPage, PartyRef, PaymentTermsDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { BillLineGrid } from "./bills-line-grid";
import { type BillLineDraft, billLineProblem, billLineToInput, KIND_EXPLANATIONS, lineForItem, linesFromBill, linesFromDraftReceipt, linesFromReceipt, type NewBillKind, previewBill } from "./bills-lines";

interface BillEditorProps {
  kind: NewBillKind;
  /** The saved draft, or null for a new bill. */
  bill: SupplierBillDto | null;
  onSaved: (bill: SupplierBillDto) => void;
  /** Editing a draft: go back to viewing it. */
  onClose?: () => void;
}

/** Records a new supplier bill, or changes a draft one. */
export function BillEditor(props: BillEditorProps) {
  const { bill } = props;
  const receiptId = bill?.kind === "receives_goods" ? bill.receiptId : null;
  const initial = useLoad<BillLineDraft[]>(async () => {
    if (!bill) return [];
    if (receiptId) return linesFromDraftReceipt(await api.get<GoodsReceiptDto>(`/purchase/receipts/${receiptId}`));
    return linesFromBill(bill);
  }, [bill?.id, receiptId]);
  if (initial.error) return <Alert kind="error">{`Could not load the bill's lines: ${initial.error}`}</Alert>;
  if (!initial.data) return <p className="muted">Loading…</p>;
  return <EditorForm key={bill?.id ?? "new"} {...props} initialLines={initial.data} />;
}

interface HeaderState {
  supplier: PartyRef | null;
  supplierBillNo: string;
  supplierBillDate: string;
  postingDate: string;
  paymentTermsId: string;
  storeId: string;
  remarks: string;
}

function EditorForm({ kind, bill, onSaved, onClose, initialLines }: BillEditorProps & { initialLines: BillLineDraft[] }) {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const today = useBusinessToday();
  const locations = useStockLocations();
  const terms = useLoad(() => api.get<PaymentTermsDto[]>("/payment-terms"));
  const stores = storesFromLocations(locations.data ?? []);
  const [header, setHeader] = useState<HeaderState>(() => ({
    supplier: bill ? bill.supplier : null,
    supplierBillNo: bill?.supplierBillNo ?? "",
    supplierBillDate: bill?.supplierBillDate ?? "",
    postingDate: bill?.postingDate ?? "",
    paymentTermsId: bill?.paymentTermsId ?? "",
    storeId: bill?.storeId ?? "",
    remarks: bill?.remarks ?? "",
  }));
  const [lines, setLines] = useState<BillLineDraft[]>(initialLines);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const storeId = header.storeId || (kind === "receives_goods" ? defaultStoreId(user, stores) : "");
  const shelves = storeId ? stockLocationsOf(locations.data ?? [], storeId) : [];
  const preview = previewBill(lines);

  function set<K extends keyof HeaderState>(key: K, value: HeaderState[K]) {
    setHeader((h) => ({ ...h, [key]: value }));
  }

  function changeSupplier(p: PartyRef | null) {
    set("supplier", p);
    // Receipt lines belong to one supplier.
    if (kind === "against_receipt") setLines([]);
  }

  function check(): boolean {
    const errs: Record<string, string> = {};
    if (!header.supplier) errs.supplierId = "Choose the supplier";
    if (!header.supplierBillNo.trim()) errs.supplierBillNo = "Type the bill number printed on the supplier's bill";
    if (!header.supplierBillDate) errs.supplierBillDate = "Give the date on the supplier's bill";
    else if (today && header.supplierBillDate > today) errs.supplierBillDate = "The supplier's bill date cannot be in the future";
    if (header.postingDate && today && header.postingDate > today) errs.postingDate = "The posting date cannot be in the future";
    if (kind === "receives_goods" && !storeId) errs.storeId = "Choose the store the goods arrive at";
    const probs: Record<string, string> = {};
    for (const l of lines) {
      const p = billLineProblem(l, kind);
      if (p) probs[l.key] = p;
    }
    if (!lines.some((l) => l.include)) errs.lines = kind === "against_receipt" ? "Tick at least one receipt line to bill" : "Add at least one line";
    setErrors(errs);
    setProblems(probs);
    return Object.keys(errs).length === 0 && Object.keys(probs).length === 0;
  }

  async function save() {
    setError(null);
    if (!check()) return;
    const body = {
      supplierId: header.supplier!.id,
      supplierBillNo: header.supplierBillNo.trim(),
      supplierBillDate: header.supplierBillDate,
      ...(header.postingDate ? { postingDate: header.postingDate } : {}),
      ...(kind === "receives_goods" ? { storeId } : {}),
      paymentTermsId: header.paymentTermsId || null,
      remarks: blankToNull(header.remarks),
      lines: lines.filter((l) => l.include).map((l) => billLineToInput(l, kind)),
    };
    setBusy(true);
    try {
      const saved = bill ? await api.patch<SupplierBillDto>(`/purchase/bills/${bill.id}`, body) : await api.post<SupplierBillDto>("/purchase/bills", { kind, ...body });
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError) setErrors(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>{bill ? `Change draft bill ${bill.number}` : "Record a supplier bill"}</h1>
      <p>
        <strong>{BILL_KIND_LABELS[kind]}.</strong> <span className="muted">{KIND_EXPLANATIONS[kind]}</span>
      </p>
      <div className="card">
        <div className="form-grid">
          <PartyPicker id="bill-supplier" label="Supplier" kind="supplier" value={header.supplier} onChange={changeSupplier} disabled={!!bill} error={errors.supplierId} hint="Type part of the supplier's code, name or mobile." />
          <TextInput id="bill-no" label="Supplier's bill number" required value={header.supplierBillNo} onChange={(e) => set("supplierBillNo", e.target.value)} error={errors.supplierBillNo} />
          <TextInput id="bill-date" label="Supplier's bill date" type="date" required max={today || undefined} value={header.supplierBillDate} onChange={(e) => set("supplierBillDate", e.target.value)} error={errors.supplierBillDate} />
          <TextInput
            id="bill-posting"
            label="Posting date"
            type="date"
            max={today || undefined}
            value={header.postingDate}
            onChange={(e) => set("postingDate", e.target.value)}
            error={errors.postingDate}
            hint={today ? `Blank means today (${formatDate(today)}).` : "Blank means today."}
          />
          {terms.data ? (
            <SelectInput id="bill-terms" label="Payment terms" value={header.paymentTermsId} onChange={(e) => set("paymentTermsId", e.target.value)} hint="Sets the due date. Blank uses the supplier's usual terms.">
              <option value="">Supplier&apos;s usual terms</option>
              {terms.data
                .filter((t) => t.active || t.id === header.paymentTermsId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.name}
                  </option>
                ))}
            </SelectInput>
          ) : null}
          {kind === "receives_goods" ? (
            <SelectInput id="bill-store" label="Store the goods arrive at" required value={storeId} onChange={(e) => set("storeId", e.target.value)} error={errors.storeId}>
              <option value="">Choose…</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </SelectInput>
          ) : null}
        </div>
        <TextareaInput id="bill-remarks" label="Remarks" value={header.remarks} onChange={(e) => set("remarks", e.target.value)} />
      </div>

      {kind === "against_receipt" ? (
        header.supplier ? (
          <ReceiptChooser supplierId={header.supplier.id} added={new Set(lines.map((l) => l.receipt?.id).filter((x): x is string => !!x))} onAdd={(more) => setLines((ls) => [...ls, ...more])} />
        ) : (
          <p className="muted">Choose the supplier first; their goods receipts waiting for a bill will be listed.</p>
        )
      ) : kind === "receives_goods" ? (
        <StockItemAdder onAdd={(item, unitId) => setLines((ls) => [...ls, lineForItem(item, unitId)])} />
      ) : (
        <ServiceItemAdder onAdd={(item) => setLines((ls) => [...ls, lineForItem(item, null)])} />
      )}

      <h2>Lines</h2>
      {rights.prices ? (
        <p className="muted">
          Type the GST exactly as written on the supplier&apos;s bill. Leave CGST, SGST and IGST blank and they will be worked out from the GST rate.
        </p>
      ) : null}
      <BillLineGrid kind={kind} lines={lines} onChange={setLines} problems={problems} shelves={shelves} prices={rights.prices} />
      {errors.lines ? (
        <p className="field-error" role="alert">
          {errors.lines}
        </p>
      ) : null}

      {rights.prices ? (
        <div className="card" aria-label="Preview of the totals">
          <dl className="kv">
            <dt>Before GST</dt>
            <dd>{rupees(preview.taxable.toFixed(2))}</dd>
            <dt>GST</dt>
            <dd>{rupees(preview.tax.toFixed(2))}</dd>
            <dt>Rounding</dt>
            <dd>{rupees(preview.roundingAdjustment.toFixed(2))}</dd>
            <dt>Total (preview)</dt>
            <dd>
              <strong>{rupees(preview.total.toFixed(2))}</strong>
            </dd>
          </dl>
          <p className="muted">
            This is a preview. The figures saved are the ones worked out by the server.
            {preview.unpriced > 0 ? ` ${preview.unpriced} line${preview.unpriced === 1 ? " has" : "s have"} no price typed; the price list or last purchase price will be used.` : ""}
          </p>
        </div>
      ) : null}

      <Alert kind="error">{error ?? locations.error}</Alert>
      <div className="actions">
        <Button variant="primary" busy={busy} onClick={save}>
          {bill ? "Save changes" : "Save draft"}
        </Button>
        {onClose ? <Button onClick={onClose}>Back without saving</Button> : null}
      </div>
    </>
  );
}

/** Goods receipts of the supplier that still have something to bill. */
function ReceiptChooser({ supplierId, added, onAdd }: { supplierId: string; added: Set<string>; onAdd: (lines: BillLineDraft[]) => void }) {
  const receipts = useLoad(async () => {
    const [toBill, partly] = await Promise.all(
      (["to_bill", "partly_billed"] as const).map((status) => api.get<Page<GoodsReceiptHeader>>(`/purchase/receipts${query({ supplierId, status, isReturn: "false", pageSize: 200 })}`)),
    );
    return [...toBill.rows, ...partly.rows].sort((a, b) => a.postingDate.localeCompare(b.postingDate));
  }, [supplierId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function add(id: string) {
    setBusy(id);
    setNote(null);
    try {
      const receipt = await api.get<GoodsReceiptDto>(`/purchase/receipts/${id}`);
      const lines = linesFromReceipt(receipt);
      if (lines.length === 0) setNote(`Everything on ${receipt.number} is already billed.`);
      onAdd(lines);
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <h2>Goods receipts waiting for a bill</h2>
      <Alert kind="error">{receipts.error}</Alert>
      {receipts.loading && !receipts.data ? <p className="muted">Loading…</p> : null}
      {receipts.data && receipts.data.length === 0 ? <p className="muted">Nothing from this supplier is waiting for a bill.</p> : null}
      {receipts.data && receipts.data.length > 0 ? (
        <ul className="check-list">
          {receipts.data.map((r) => (
            <li key={r.id} className="check-row">
              <span>
                <span className="mono">{r.number}</span> · {formatDate(r.postingDate)} · {r.store.code} · {RECEIPT_STATUS_LABELS[r.status]}
                {r.deliveryNoteNo ? <span className="muted"> · delivery note {r.deliveryNoteNo}</span> : null}
              </span>{" "}
              {added.has(r.id) ? (
                <span className="muted">Added</span>
              ) : (
                <Button size="small" busy={busy === r.id} onClick={() => add(r.id)} aria-label={`Add lines of ${r.number}`}>
                  Add its lines
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {note ? <p className="muted">{note}</p> : null}
    </div>
  );
}

/** Search for services and other non-stock items. */
function ServiceItemAdder({ onAdd }: { onAdd: (item: ItemDto) => void }) {
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<ItemDto[]>([]);
  const [note, setNote] = useState<string | null>(null);

  async function search() {
    setNote(null);
    setMatches([]);
    const t = text.trim();
    if (!t) return;
    try {
      const page = await api.get<ItemPage>(`/items${query({ search: t, active: "true", kind: "service", pageSize: 20 })}`);
      const rows = page.rows.filter((r) => !r.isStockItem);
      setMatches(rows);
      if (rows.length === 0) setNote(`No services match "${t}".`);
    } catch (err) {
      setNote(errorMessage(err));
    }
  }

  async function pick(id: string) {
    try {
      onAdd(await api.get<ItemDto>(`/items/${id}`));
      setMatches([]);
      setText("");
    } catch (err) {
      setNote(errorMessage(err));
    }
  }

  return (
    <div className="card">
      <form
        className="toolbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <TextInput id="bill-service-search" label="Add a service or non-stock item" placeholder="Type a code or name, then press Enter" value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit">Search</Button>
      </form>
      {note ? <p className="muted">{note}</p> : null}
      {matches.length > 0 ? (
        <ul className="picker-results picker-results-static">
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" className="picker-result" onClick={() => pick(m.id)}>
                <span className="mono">{m.code}</span> {m.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
