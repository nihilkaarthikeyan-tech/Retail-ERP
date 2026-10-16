// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { PartyPicker } from "@/components/parties/party-picker";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert, Button, DataTable, Field, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { BILL_KIND_LABELS, downloadCsv, ORDER_STATUS_LABELS, purchaseRights, rupees, type PurchaseOrderStatus, type SupplierBillKind, toCsv } from "@/lib/purchasing";
import { showQuantity, storesFromLocations } from "@/lib/stock";
import type { ItemPage, ItemRef, PartyRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

type Named = { code: string; name: string };

export interface FollowUpRow {
  orderId: string;
  orderNumber: string;
  status: PurchaseOrderStatus;
  supplier: Named;
  item: Named;
  storeId: string;
  orderDate: string;
  neededBy: string;
  ordered: string;
  received: string;
  pending: string;
  daysLate: number;
  orderedAmount?: string;
  billedAmount?: string;
}

export interface NotBilledRow {
  receiptId: string;
  receiptNumber: string;
  supplier: Named;
  item: Named;
  postingDate: string;
  ageDays: number;
  notBilled: string;
  value?: string;
}

export interface RegisterRow {
  billId: string;
  number: string;
  kind: SupplierBillKind;
  supplier: Named & { gstin: string | null };
  supplierBillNo: string;
  supplierBillDate: string;
  postingDate: string;
  item: Named & { hsnCode: string | null };
  quantity: string;
  rate: string;
  taxableAmount: string;
  gstRate: string;
  cgst: string;
  sgst: string;
  igst: string;
  lineTotal: string;
}

export interface BySupplierRow {
  supplier: Named;
  bills: number;
  taxableAmount: string;
  taxAmount: string;
  total: string;
}

export interface ByItemRow {
  item: Named;
  quantity: string;
  taxableAmount: string;
  averageRate: string;
}

/** One report column: what the table shows and what goes into the CSV file. */
export interface ReportColumn<T> {
  key: string;
  header: string;
  /** The plain value (for the CSV). */
  value: (row: T) => string | number | null | undefined;
  /** What the table shows; the plain value when left out. */
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
}

/** CSV text of a report: the same columns as on screen, plain values. */
export function reportCsv<T>(columns: ReportColumn<T>[], rows: T[]): string {
  return toCsv(
    columns.map((c) => c.header),
    rows.map((r) => columns.map((c) => c.value(r))),
  );
}

export type ReportTab = "order-follow-up" | "received-not-billed" | "register" | "by-supplier" | "by-item";

export const REPORT_TABS: { id: ReportTab; label: string; needsPrices: boolean; filters: ("dates" | "supplier" | "store" | "item")[]; dateHint: string }[] = [
  { id: "order-follow-up", label: "Order follow-up", needsPrices: false, filters: ["dates", "supplier", "store", "item"], dateHint: "Order date" },
  { id: "received-not-billed", label: "Goods received not billed", needsPrices: false, filters: ["dates", "supplier", "store", "item"], dateHint: "Receipt date" },
  { id: "register", label: "Purchase register", needsPrices: true, filters: ["dates", "supplier", "item"], dateHint: "Posting date" },
  { id: "by-supplier", label: "By supplier", needsPrices: true, filters: ["dates", "supplier", "item"], dateHint: "Posting date" },
  { id: "by-item", label: "By item", needsPrices: true, filters: ["dates", "supplier", "item"], dateHint: "Posting date" },
];

const named = (n: Named) => `${n.code} ${n.name}`;
const showNamed = (n: Named) => (
  <>
    <span className="mono">{n.code}</span> {n.name}
  </>
);

export function followUpColumns(withAmounts: boolean): ReportColumn<FollowUpRow>[] {
  return [
    { key: "order", header: "Order", value: (r) => r.orderNumber, render: (r) => <Link href={`/purchases/orders/${r.orderId}`}>{r.orderNumber}</Link> },
    { key: "status", header: "Status", value: (r) => ORDER_STATUS_LABELS[r.status] ?? r.status },
    { key: "supplier", header: "Supplier", value: (r) => named(r.supplier), render: (r) => showNamed(r.supplier) },
    { key: "item", header: "Item", value: (r) => named(r.item), render: (r) => showNamed(r.item) },
    { key: "orderDate", header: "Order date", value: (r) => r.orderDate, render: (r) => formatDate(r.orderDate) },
    { key: "neededBy", header: "Needed by", value: (r) => r.neededBy, render: (r) => formatDate(r.neededBy) },
    { key: "ordered", header: "Ordered", align: "right", value: (r) => showQuantity(r.ordered) },
    { key: "received", header: "Received", align: "right", value: (r) => showQuantity(r.received) },
    { key: "pending", header: "Still to come", align: "right", value: (r) => showQuantity(r.pending) },
    { key: "late", header: "Days late", align: "right", value: (r) => r.daysLate, render: (r) => (r.daysLate > 0 ? <span className="badge badge-off">{r.daysLate}</span> : "—") },
    ...(withAmounts
      ? ([
          { key: "orderedAmount", header: "Ordered value", align: "right", value: (r) => r.orderedAmount, render: (r) => rupees(r.orderedAmount) },
          { key: "billedAmount", header: "Billed value", align: "right", value: (r) => r.billedAmount, render: (r) => rupees(r.billedAmount) },
        ] satisfies ReportColumn<FollowUpRow>[])
      : []),
  ];
}

export function notBilledColumns(withValue: boolean): ReportColumn<NotBilledRow>[] {
  return [
    { key: "receipt", header: "Goods receipt", value: (r) => r.receiptNumber, render: (r) => <Link href={`/purchases/receipts/${r.receiptId}`}>{r.receiptNumber}</Link> },
    { key: "date", header: "Received on", value: (r) => r.postingDate, render: (r) => formatDate(r.postingDate) },
    { key: "age", header: "Days waiting", align: "right", value: (r) => r.ageDays },
    { key: "supplier", header: "Supplier", value: (r) => named(r.supplier), render: (r) => showNamed(r.supplier) },
    { key: "item", header: "Item", value: (r) => named(r.item), render: (r) => showNamed(r.item) },
    { key: "notBilled", header: "Not billed (basic units)", align: "right", value: (r) => showQuantity(r.notBilled) },
    ...(withValue ? ([{ key: "value", header: "Value", align: "right", value: (r) => r.value, render: (r) => rupees(r.value) }] satisfies ReportColumn<NotBilledRow>[]) : []),
  ];
}

export const REGISTER_COLUMNS: ReportColumn<RegisterRow>[] = [
  { key: "number", header: "Our number", value: (r) => r.number, render: (r) => <Link href={`/purchases/bills/${r.billId}`}>{r.number}</Link> },
  { key: "kind", header: "Kind", value: (r) => BILL_KIND_LABELS[r.kind] ?? r.kind },
  { key: "postingDate", header: "Posting date", value: (r) => r.postingDate, render: (r) => formatDate(r.postingDate) },
  { key: "supplier", header: "Supplier", value: (r) => named(r.supplier), render: (r) => showNamed(r.supplier) },
  { key: "gstin", header: "Supplier GSTIN", value: (r) => r.supplier.gstin ?? "" },
  { key: "supplierBillNo", header: "Supplier's bill no", value: (r) => r.supplierBillNo },
  { key: "supplierBillDate", header: "Supplier's bill date", value: (r) => r.supplierBillDate, render: (r) => formatDate(r.supplierBillDate) },
  { key: "item", header: "Item", value: (r) => named(r.item), render: (r) => showNamed(r.item) },
  { key: "hsn", header: "HSN", value: (r) => r.item.hsnCode ?? "" },
  { key: "quantity", header: "Quantity", align: "right", value: (r) => showQuantity(r.quantity) },
  { key: "rate", header: "Price", align: "right", value: (r) => r.rate, render: (r) => rupees(r.rate) },
  { key: "taxable", header: "Before GST", align: "right", value: (r) => r.taxableAmount, render: (r) => rupees(r.taxableAmount) },
  { key: "gstRate", header: "GST %", align: "right", value: (r) => showQuantity(r.gstRate) },
  { key: "cgst", header: "CGST", align: "right", value: (r) => r.cgst, render: (r) => rupees(r.cgst) },
  { key: "sgst", header: "SGST", align: "right", value: (r) => r.sgst, render: (r) => rupees(r.sgst) },
  { key: "igst", header: "IGST", align: "right", value: (r) => r.igst, render: (r) => rupees(r.igst) },
  { key: "total", header: "Line total", align: "right", value: (r) => r.lineTotal, render: (r) => rupees(r.lineTotal) },
];

export const BY_SUPPLIER_COLUMNS: ReportColumn<BySupplierRow>[] = [
  { key: "supplier", header: "Supplier", value: (r) => named(r.supplier), render: (r) => showNamed(r.supplier) },
  { key: "bills", header: "Bills", align: "right", value: (r) => r.bills },
  { key: "taxable", header: "Before GST", align: "right", value: (r) => r.taxableAmount, render: (r) => rupees(r.taxableAmount) },
  { key: "tax", header: "GST", align: "right", value: (r) => r.taxAmount, render: (r) => rupees(r.taxAmount) },
  { key: "total", header: "Total", align: "right", value: (r) => r.total, render: (r) => rupees(r.total) },
];

export const BY_ITEM_COLUMNS: ReportColumn<ByItemRow>[] = [
  { key: "item", header: "Item", value: (r) => named(r.item), render: (r) => showNamed(r.item) },
  { key: "quantity", header: "Quantity", align: "right", value: (r) => showQuantity(r.quantity) },
  { key: "taxable", header: "Before GST", align: "right", value: (r) => r.taxableAmount, render: (r) => rupees(r.taxableAmount) },
  { key: "average", header: "Average price", align: "right", value: (r) => r.averageRate, render: (r) => rupees(r.averageRate) },
];

interface Filters {
  from: string;
  to: string;
  supplier: PartyRef | null;
  storeId: string;
  item: ItemRef | null;
}

/** The five purchase reports, each with a table and a CSV download. */
export function PurchaseReports() {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const params = useSearchParams();
  // The report centre links straight to a tab (?tab=register).
  const [tab, setTab] = useState<ReportTab>(() => REPORT_TABS.find((t) => t.id === params.get("tab"))?.id ?? "order-follow-up");
  const [filters, setFilters] = useState<Filters>({ from: "", to: "", supplier: null, storeId: "", item: null });
  const def = REPORT_TABS.find((t) => t.id === tab)!;

  return (
    <>
      <h1>Purchase reports</h1>
      <div className="tabs" role="tablist" aria-label="Reports">
        {REPORT_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} className="tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {def.needsPrices && !rights.prices ? (
          <Alert kind="info">This report shows buying prices. Ask your manager for the right to see buying prices.</Alert>
        ) : (
          <>
            <ReportFilters tab={tab} filters={filters} onChange={setFilters} />
            <ReportBody key={tab} tab={tab} filters={filters} prices={rights.prices} />
          </>
        )}
      </div>
    </>
  );
}

function ReportFilters({ tab, filters, onChange }: { tab: ReportTab; filters: Filters; onChange: (f: Filters) => void }) {
  const def = REPORT_TABS.find((t) => t.id === tab)!;
  const withStore = def.filters.includes("store");
  const locations = useStockLocations();
  const stores = storesFromLocations(locations.data ?? []);
  return (
    <div className="filter-row">
      <TextInput id="rep-from" label={`${def.dateHint} from`} type="date" value={filters.from} onChange={(e) => onChange({ ...filters, from: e.target.value })} />
      <TextInput id="rep-to" label="to" type="date" value={filters.to} onChange={(e) => onChange({ ...filters, to: e.target.value })} />
      <PartyPicker id="rep-supplier" label="Supplier" kind="supplier" value={filters.supplier} onChange={(p) => onChange({ ...filters, supplier: p })} hint="Leave empty for all suppliers." />
      {withStore ? (
        <SelectInput id="rep-store" label="Store" value={filters.storeId} onChange={(e) => onChange({ ...filters, storeId: e.target.value })}>
          <option value="">All my stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
      ) : null}
      <ItemFilter value={filters.item} onChange={(item) => onChange({ ...filters, item })} />
    </div>
  );
}

/** Pick one item to narrow a report to (search by code or name). */
function ItemFilter({ value, onChange }: { value: ItemRef | null; onChange: (item: ItemRef | null) => void }) {
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<ItemRef[]>([]);
  const [note, setNote] = useState<string | null>(null);

  async function search() {
    setNote(null);
    const t = text.trim();
    if (!t) return;
    try {
      const page = await api.get<ItemPage>(`/items${query({ search: t, pageSize: 20 })}`);
      setMatches(page.rows.filter((r) => !r.isParentStyle).map((r) => ({ id: r.id, code: r.code, name: r.name })));
      if (page.rows.length === 0) setNote(`Nothing matches "${t}".`);
    } catch (err) {
      setNote(errorMessage(err));
    }
  }

  if (value) {
    return (
      <Field id="rep-item" label="Item">
        <div className="toolbar" style={{ margin: 0 }}>
          <span id="rep-item">
            <span className="mono">{value.code}</span> — {value.name}
          </span>
          <Button size="small" onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      </Field>
    );
  }
  return (
    <Field id="rep-item" label="Item" hint="Type a code or name and press Enter. Leave empty for all items.">
      <div className="picker">
        <input
          id="rep-item"
          className="input"
          value={text}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
        />
        {note ? <p className="muted">{note}</p> : null}
        {matches.length > 0 ? (
          <ul className="picker-results picker-results-static">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="picker-result"
                  onClick={() => {
                    onChange(m);
                    setMatches([]);
                    setText("");
                  }}
                >
                  <span className="mono">{m.code}</span> {m.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Field>
  );
}

function ReportBody({ tab, filters, prices }: { tab: ReportTab; filters: Filters; prices: boolean }) {
  const def = REPORT_TABS.find((t) => t.id === tab)!;
  const params = query({
    from: filters.from,
    to: filters.to,
    supplierId: filters.supplier?.id,
    storeId: def.filters.includes("store") ? filters.storeId : undefined,
    itemId: filters.item?.id,
  });
  const rows = useLoad(() => api.get<unknown[]>(`/purchase/reports/${tab}${params}`), [tab, params]);

  switch (tab) {
    case "order-follow-up": {
      const data = rows.data as FollowUpRow[] | null;
      return <ReportTable name={tab} columns={followUpColumns(prices && (data ?? []).some((r) => r.orderedAmount !== undefined))} rows={data} error={rows.error} loading={rows.loading} rowKey={(r, i) => `${r.orderId}-${r.item.code}-${i}`} empty="No open order lines." />;
    }
    case "received-not-billed": {
      const data = rows.data as NotBilledRow[] | null;
      return <ReportTable name={tab} columns={notBilledColumns(prices && (data ?? []).some((r) => r.value !== undefined))} rows={data} error={rows.error} loading={rows.loading} rowKey={(r, i) => `${r.receiptId}-${r.item.code}-${i}`} empty="Everything received has been billed." />;
    }
    case "register":
      return <ReportTable name={tab} columns={REGISTER_COLUMNS} rows={rows.data as RegisterRow[] | null} error={rows.error} loading={rows.loading} rowKey={(r, i) => `${r.billId}-${i}`} empty="No bills in this period." />;
    case "by-supplier":
      return <ReportTable name={tab} columns={BY_SUPPLIER_COLUMNS} rows={rows.data as BySupplierRow[] | null} error={rows.error} loading={rows.loading} rowKey={(r) => r.supplier.code} empty="No bills in this period." />;
    case "by-item":
      return <ReportTable name={tab} columns={BY_ITEM_COLUMNS} rows={rows.data as ByItemRow[] | null} error={rows.error} loading={rows.loading} rowKey={(r) => r.item.code} empty="No bills in this period." />;
  }
}

function ReportTable<T>({ name, columns, rows, error, loading, rowKey, empty }: { name: string; columns: ReportColumn<T>[]; rows: T[] | null; error: string | null; loading: boolean; rowKey: (row: T, index: number) => string; empty: string }) {
  const keyed = (rows ?? []).map((row, index) => ({ row, key: rowKey(row, index) }));
  const tableColumns: Column<{ row: T; key: string }>[] = columns.map((c) => ({ key: c.key, header: c.header, align: c.align, render: ({ row }) => (c.render ? c.render(row) : (c.value(row) ?? "—")) }));
  return (
    <>
      <div className="toolbar">
        <span className="muted">
          {rows ? `${rows.length} row${rows.length === 1 ? "" : "s"}` : ""}
        </span>
        <span className="spacer" />
        <Button size="small" disabled={!rows || rows.length === 0} onClick={() => downloadCsv(`purchase-${name}.csv`, reportCsv(columns, rows ?? []))}>
          Download for Excel (CSV)
        </Button>
      </div>
      <Alert kind="error">{error}</Alert>
      <DataTable columns={tableColumns} rows={rows ? keyed : null} rowKey={(r) => r.key} loading={loading} empty={empty} />
    </>
  );
}
