// Copyright (c) 2026, Rademics. All rights reserved.
// Till reports (plan 06 §1 item 12; decision 66): each with a table and a CSV download.
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { LedgerEntryButton } from "@/components/accounts/ledger-entry";
import { Alert, Badge, Button, CheckInput, DataTable, Dialog, SelectInput, TextareaInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime } from "@/lib/format";
import { useModules } from "@/lib/modules";
import { downloadCsv, rupees, toCsv } from "@/lib/purchasing";
import { indianTime } from "@/lib/stock";
import { useLoad } from "@/lib/use-load";
import { FlagBadges, flagLabel, PAYMENT_KIND_LABELS, type PaymentKind, posRights, usePaymentMethods, useTills } from "./pos-shared";

export interface RegisterRow {
  id: string;
  number: string;
  kind: "sale" | "return";
  soldAt: string;
  businessDate: string;
  till: string;
  total: string;
  payments: string;
  offline: boolean;
  flags: string[];
}

export interface PaymentsRow {
  date: string;
  method: string;
  kind: PaymentKind;
  amount: string;
  count: number;
}

export interface HourlyRow {
  hour: number;
  bills: number;
  total: string;
}

export interface CashierRow {
  cashierId: string;
  name: string;
  bills: number;
  returns: number;
  total: string;
}

/** Plan 11 C1: sales by salesperson, net of returns. */
export interface SalespersonRow {
  period: string;
  salesStaffId: string | null;
  code: string;
  name: string;
  bills: number;
  returns: number;
  sales: string;
  returnsAmount: string;
  net: string;
}

export interface ShiftRow {
  id: string;
  till: string;
  businessDate: string;
  status: "open" | "closed" | "cancelled";
  openedAt: string;
  closedAt: string | null;
  salesTotal: string | null;
  returnsTotal: string | null;
  difference: string | null;
}

export interface OfflineRow {
  id: string;
  number: string;
  till: string;
  soldAt: string;
  offline: boolean;
  total: string;
  flags: string[];
  /** Audit 5 (pos-offline §5): per flagged line, what was charged and what the server's list, offer, rate and limits said. */
  lines?: { lineNo: number; item: { code: string; name: string }; charged: { listPrice: string; price: string; offerDiscount: string; gstRate: string; lineTotal: string }; server: Record<string, string> }[];
}

/** What was charged against what the server said, in plain words, one line of the bill at a time. */
export function chargedAgainstList(r: OfflineRow): string[] {
  return (r.lines ?? []).map((l) => {
    const s = l.server;
    const parts: string[] = [];
    if (s.price !== undefined && s.price !== l.charged.price) parts.push(`charged ${rupees(l.charged.price)}, the price list said ${rupees(s.price)}`);
    if (s.offerDiscount !== undefined && s.offerDiscount !== l.charged.offerDiscount) parts.push(`offer ${rupees(l.charged.offerDiscount)} off, the offers said ${rupees(s.offerDiscount)}`);
    if (s.gstRate !== undefined && Number(s.gstRate) !== Number(l.charged.gstRate)) parts.push(`GST ${l.charged.gstRate}%, the rate list said ${s.gstRate}%`);
    if (s.discountPercent !== undefined) parts.push(`discount ${s.discountPercent}% (cashier's limit ${s.cashierLimitPercent}%, item's maximum ${s.maxDiscountPercent}%)`);
    if (s.costFloor !== undefined) parts.push(`sold for ${rupees(l.charged.lineTotal)}, cost ${rupees(s.costFloor)} a piece`);
    if (s.mrp !== undefined && Number(l.charged.price) > Number(s.mrp)) parts.push(`price ${rupees(l.charged.price)} above the MRP ${rupees(s.mrp)}`);
    return `${l.item.code} ${l.item.name}: ${parts.join("; ") || "see the bill"}`;
  });
}

export interface SyncProblemRow {
  id: string;
  till: string | undefined;
  clientId: string;
  kind: string;
  error: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

/** GET /pos/shifts/:id */
export interface ShiftDetailDto {
  id: string;
  till: { id: string; code: string; name: string };
  businessDate: string;
  openedAt: string;
  status: "open" | "closed" | "cancelled";
  closedAt: string | null;
  cashMovements: { id: string; direction: "in" | "out"; amount: string; reason: string; at: string }[];
  closing: {
    closedAt: string;
    denominations: Record<string, number>;
    remarks: string | null;
    approvedById: string | null;
    bills: number;
    salesTotal: string;
    returnsTotal: string;
    taxableTotal: string;
    cgstTotal: string;
    sgstTotal: string;
    igstTotal: string;
    roundingTotal: string;
    lines: { paymentMethodId: string; opening: string; expected: string; counted: string; difference: string }[];
  } | null;
  expected: { paymentMethodId: string; name: string; kind: string; opening: string; received: string; change: string; cashIn: string; cashOut: string; expected: string }[];
  /** Audit 5 (C4): every opening of the cash drawer during the shift. */
  drawerOpenings?: { id: string; kind: "sale" | "no_sale"; at: string; billClientId: string | null; approvedById: string | null; byId: string }[];
}

/** One report column: what the table shows and what goes into the CSV file. */
interface ReportColumn<T> {
  key: string;
  header: string;
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
}

type Tab = "register" | "payments" | "hourly" | "by-cashier" | "by-salesperson" | "shifts" | "offline-check" | "sync-problems";

const TABS: { id: Tab; label: string }[] = [
  { id: "register", label: "Till register" },
  { id: "payments", label: "Payments by method" },
  { id: "hourly", label: "Hourly sales" },
  { id: "by-cashier", label: "Sales per cashier" },
  { id: "by-salesperson", label: "Sales by salesperson" },
  { id: "shifts", label: "Shifts" },
  { id: "offline-check", label: "Offline bills to check" },
  { id: "sync-problems", label: "Sync problems" },
];

const flagsText = (flags: string[]) => flags.map(flagLabel).join("; ");
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`;
const SHIFT_STATUS: Record<ShiftRow["status"], string> = { open: "Open", closed: "Closed", cancelled: "Cancelled" };

const REGISTER: ReportColumn<RegisterRow>[] = [
  { key: "number", header: "Bill", value: (r) => r.number, render: (r) => <Link href={`/pos/bills/${r.id}`} className="mono">{r.number}</Link> },
  { key: "date", header: "Date", value: (r) => r.businessDate, render: (r) => formatDate(r.businessDate) },
  { key: "time", header: "Time", value: (r) => indianTime(r.soldAt) },
  { key: "till", header: "Till", value: (r) => r.till },
  { key: "kind", header: "Kind", value: (r) => (r.kind === "return" ? "Return" : "Sale") },
  { key: "payments", header: "Payments", value: (r) => r.payments },
  { key: "offline", header: "Offline", value: (r) => (r.offline ? "Yes" : "No") },
  { key: "flags", header: "To check", value: (r) => flagsText(r.flags), render: (r) => <FlagBadges flags={r.flags} /> },
  { key: "total", header: "Total", align: "right", value: (r) => r.total, render: (r) => rupees(r.total) },
];

const PAYMENTS: ReportColumn<PaymentsRow>[] = [
  { key: "date", header: "Date", value: (r) => r.date, render: (r) => formatDate(r.date) },
  { key: "method", header: "Payment method", value: (r) => r.method },
  { key: "kind", header: "Kind", value: (r) => PAYMENT_KIND_LABELS[r.kind] ?? r.kind },
  { key: "count", header: "Payments", align: "right", value: (r) => r.count },
  { key: "amount", header: "Amount", align: "right", value: (r) => r.amount, render: (r) => rupees(r.amount) },
];

const HOURLY: ReportColumn<HourlyRow>[] = [
  { key: "hour", header: "Hour (Indian time)", value: (r) => hourLabel(r.hour) },
  { key: "bills", header: "Sale bills", align: "right", value: (r) => r.bills },
  { key: "total", header: "Net sales", align: "right", value: (r) => r.total, render: (r) => rupees(r.total) },
];

const BY_CASHIER: ReportColumn<CashierRow>[] = [
  { key: "name", header: "Cashier", value: (r) => r.name },
  { key: "bills", header: "Sale bills", align: "right", value: (r) => r.bills },
  { key: "returns", header: "Returns", align: "right", value: (r) => r.returns },
  { key: "total", header: "Net sales", align: "right", value: (r) => r.total, render: (r) => rupees(r.total) },
];

const BY_SALESPERSON: ReportColumn<SalespersonRow>[] = [
  { key: "period", header: "Day or month", value: (r) => r.period, render: (r) => (r.period.length === 7 ? r.period : formatDate(r.period)) },
  { key: "name", header: "Salesperson", value: (r) => r.name },
  { key: "code", header: "Code", value: (r) => r.code, render: (r) => <span className="mono">{r.code}</span> },
  { key: "bills", header: "Bills", align: "right", value: (r) => r.bills },
  { key: "returns", header: "Returns", align: "right", value: (r) => r.returns },
  { key: "sales", header: "Sales", align: "right", value: (r) => r.sales, render: (r) => rupees(r.sales) },
  { key: "returnsAmount", header: "Returned", align: "right", value: (r) => r.returnsAmount, render: (r) => rupees(r.returnsAmount) },
  { key: "net", header: "Net sales", align: "right", value: (r) => r.net, render: (r) => rupees(r.net) },
];

const OFFLINE: ReportColumn<OfflineRow>[] = [
  { key: "number", header: "Bill", value: (r) => r.number, render: (r) => <Link href={`/pos/bills/${r.id}`} className="mono">{r.number}</Link> },
  { key: "soldAt", header: "Sold", value: (r) => formatDateTime(r.soldAt) },
  { key: "till", header: "Till", value: (r) => r.till },
  { key: "offline", header: "Offline", value: (r) => (r.offline ? "Yes" : "No") },
  { key: "flags", header: "To check", value: (r) => flagsText(r.flags), render: (r) => <FlagBadges flags={r.flags} /> },
  {
    key: "difference",
    header: "Charged and what the list said",
    value: (r) => chargedAgainstList(r).join(" | "),
    render: (r) => {
      const text = chargedAgainstList(r);
      return text.length ? (
        <ul className="changes">
          {text.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <span className="muted">—</span>
      );
    },
  },
  { key: "total", header: "Total", align: "right", value: (r) => r.total, render: (r) => rupees(r.total) },
];

/** The eight till reports. */
export function PosReports() {
  const tills = useTills();
  const params = useSearchParams();
  // The report centre links straight to a tab (?tab=hourly).
  const [chosenTab, setTab] = useState<Tab>(() => TABS.find((t) => t.id === params.get("tab"))?.id ?? "register");
  const [filters, setFilters] = useState({ from: "", to: "", tillId: "", groupBy: "day" });
  // Plan 12: sales by salesperson only while "Salesperson" is on.
  const salespersonOn = useModules().isOn("salesperson");
  const tabs = TABS.filter((t) => t.id !== "by-salesperson" || salespersonOn);
  const tab = tabs.some((t) => t.id === chosenTab) ? chosenTab : "register";

  return (
    <>
      <h1>Till reports</h1>
      <div className="tabs" role="tablist" aria-label="Reports">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} className="tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab !== "sync-problems" ? (
          <div className="filter-row">
            <TextInput id="pr-from" label="From" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            <TextInput id="pr-to" label="To" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
            <SelectInput id="pr-till" label="Till" value={filters.tillId} onChange={(e) => setFilters({ ...filters, tillId: e.target.value })}>
              <option value="">All tills</option>
              {(tills.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} — {t.name}
                </option>
              ))}
            </SelectInput>
            {tab === "by-salesperson" ? (
              <SelectInput id="pr-group" label="By" value={filters.groupBy} onChange={(e) => setFilters({ ...filters, groupBy: e.target.value })}>
                <option value="day">Day</option>
                <option value="month">Month</option>
              </SelectInput>
            ) : null}
          </div>
        ) : null}
        {tab === "sync-problems" ? <SyncProblems /> : <ReportBody key={tab} tab={tab} params={query({ ...filters, groupBy: tab === "by-salesperson" ? filters.groupBy : undefined })} />}
      </div>
    </>
  );
}

function ReportBody({ tab, params }: { tab: Exclude<Tab, "sync-problems">; params: string }) {
  const rows = useLoad(() => api.get<unknown[]>(`/pos/reports/${tab}${params}`), [tab, params]);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const common = { name: tab, error: rows.error, loading: rows.loading };
  switch (tab) {
    case "register":
      return <ReportTable {...common} columns={REGISTER} rows={rows.data as RegisterRow[] | null} rowKey={(r) => r.id} empty="No bills in this period." />;
    case "payments":
      return <ReportTable {...common} columns={PAYMENTS} rows={rows.data as PaymentsRow[] | null} rowKey={(r) => `${r.date}-${r.method}`} empty="No payments in this period." />;
    case "hourly":
      return <ReportTable {...common} columns={HOURLY} rows={rows.data as HourlyRow[] | null} rowKey={(r) => String(r.hour)} empty="No sales in this period." />;
    case "by-cashier":
      return <ReportTable {...common} columns={BY_CASHIER} rows={rows.data as CashierRow[] | null} rowKey={(r) => r.cashierId} empty="No sales in this period." />;
    case "by-salesperson":
      return <ReportTable {...common} columns={BY_SALESPERSON} rows={rows.data as SalespersonRow[] | null} rowKey={(r) => `${r.period}-${r.salesStaffId ?? "none"}`} empty="No sales in this period." />;
    case "offline-check":
      return <ReportTable {...common} columns={OFFLINE} rows={rows.data as OfflineRow[] | null} rowKey={(r) => r.id} empty="Nothing to check." />;
    case "shifts": {
      const columns: ReportColumn<ShiftRow>[] = [
        { key: "till", header: "Till", value: (r) => r.till },
        { key: "date", header: "Business date", value: (r) => r.businessDate, render: (r) => formatDate(r.businessDate) },
        { key: "status", header: "Status", value: (r) => SHIFT_STATUS[r.status], render: (r) => <Badge kind={r.status === "closed" ? "ok" : r.status === "open" ? "warn" : "off"}>{SHIFT_STATUS[r.status]}</Badge> },
        { key: "opened", header: "Opened", value: (r) => formatDateTime(r.openedAt) },
        { key: "closed", header: "Closed", value: (r) => (r.closedAt ? formatDateTime(r.closedAt) : "") },
        { key: "sales", header: "Sales", align: "right", value: (r) => r.salesTotal, render: (r) => rupees(r.salesTotal) },
        { key: "returns", header: "Returns", align: "right", value: (r) => r.returnsTotal, render: (r) => rupees(r.returnsTotal) },
        { key: "difference", header: "Difference", align: "right", value: (r) => r.difference, render: (r) => <span className={r.difference && r.difference.startsWith("-") ? "num-negative" : undefined}>{rupees(r.difference)}</span> },
        {
          key: "details",
          header: "",
          value: () => "",
          render: (r) => (
            <Button size="small" onClick={() => setShiftId(r.id)}>
              Details
            </Button>
          ),
        },
      ];
      return (
        <>
          <ReportTable {...common} columns={columns} rows={rows.data as ShiftRow[] | null} rowKey={(r) => r.id} empty="No shifts in this period." />
          <Dialog open={shiftId !== null} title="Shift closing" onClose={() => setShiftId(null)}>
            {shiftId ? <ShiftDetails id={shiftId} /> : null}
          </Dialog>
        </>
      );
    }
  }
}

function ReportTable<T>({ name, columns, rows, error, loading, rowKey, empty }: { name: string; columns: ReportColumn<T>[]; rows: T[] | null; error: string | null; loading: boolean; rowKey: (row: T) => string; empty: string }) {
  const keyed = (rows ?? []).map((row, i) => ({ row, key: `${rowKey(row)}-${i}` }));
  const tableColumns: Column<{ row: T; key: string }>[] = columns.map((c) => ({ key: c.key, header: c.header, align: c.align, render: ({ row }) => (c.render ? c.render(row) : (c.value(row) ?? "—")) }));
  const csvColumns = columns.filter((c) => c.header !== "");
  return (
    <>
      <div className="toolbar">
        <span className="muted">{rows ? `${rows.length} row${rows.length === 1 ? "" : "s"}` : ""}</span>
        <span className="spacer" />
        <Button
          size="small"
          disabled={!rows || rows.length === 0}
          onClick={() =>
            downloadCsv(
              `till-${name}.csv`,
              toCsv(
                csvColumns.map((c) => c.header),
                (rows ?? []).map((r) => csvColumns.map((c) => c.value(r))),
              ),
            )
          }
        >
          Download for Excel (CSV)
        </Button>
      </div>
      <Alert kind="error">{error}</Alert>
      <DataTable columns={tableColumns} rows={rows ? keyed : null} rowKey={(r) => r.key} loading={loading} empty={empty} />
    </>
  );
}

function ShiftDetails({ id }: { id: string }) {
  const shift = useLoad(() => api.get<ShiftDetailDto>(`/pos/shifts/${id}`), [id]);
  const methods = usePaymentMethods();
  if (shift.error) return <Alert kind="error">{shift.error}</Alert>;
  const s = shift.data;
  if (!s) return <p className="muted">Loading…</p>;
  const methodName = (mid: string) => s.expected.find((e) => e.paymentMethodId === mid)?.name ?? methods.data?.find((m) => m.id === mid)?.name ?? "—";
  const c = s.closing;
  const notes = c ? Object.entries(c.denominations).filter(([, n]) => n > 0) : [];

  return (
    <>
      <dl className="kv">
        <dt>Till</dt>
        <dd>
          <span className="mono">{s.till.code}</span> {s.till.name}
        </dd>
        <dt>Business date</dt>
        <dd>{formatDate(s.businessDate)}</dd>
        <dt>Opened</dt>
        <dd>{formatDateTime(s.openedAt)}</dd>
        <dt>Closed</dt>
        <dd>{s.closedAt ? formatDateTime(s.closedAt) : SHIFT_STATUS[s.status]}</dd>
        {c ? (
          <>
            <dt>Bills</dt>
            <dd>{c.bills}</dd>
            <dt>Sales / returns</dt>
            <dd>
              {rupees(c.salesTotal)} / {rupees(c.returnsTotal)}
            </dd>
            <dt>GST</dt>
            <dd>
              CGST {rupees(c.cgstTotal)}, SGST {rupees(c.sgstTotal)}, IGST {rupees(c.igstTotal)}
            </dd>
            <dt>Remarks</dt>
            <dd>{c.remarks ?? "—"}</dd>
          </>
        ) : null}
      </dl>
      <h3>By payment method</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Method</th>
              <th scope="col" className="num">Opening</th>
              <th scope="col" className="num">Expected</th>
              <th scope="col" className="num">Counted</th>
              <th scope="col" className="num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {(c ? c.lines : s.expected.map((e) => ({ paymentMethodId: e.paymentMethodId, opening: e.opening, expected: e.expected, counted: null, difference: null }))).map((l) => (
              <tr key={l.paymentMethodId}>
                <td>{methodName(l.paymentMethodId)}</td>
                <td className="num">{rupees(l.opening)}</td>
                <td className="num">{rupees(l.expected)}</td>
                <td className="num">{rupees(l.counted)}</td>
                <td className={`num${l.difference?.startsWith("-") ? " num-negative" : ""}`}>{rupees(l.difference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {notes.length ? (
        <>
          <h3>Notes and coins counted</h3>
          <p>{notes.map(([d, n]) => `₹${d} × ${n}`).join(", ")}</p>
        </>
      ) : null}
      {s.cashMovements.length ? (
        <>
          <h3>Cash in and out</h3>
          <ul className="changes">
            {s.cashMovements.map((m) => (
              <li key={m.id}>
                {indianTime(m.at)} {m.direction === "in" ? "In" : "Out"} {rupees(m.amount)} — {m.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {s.drawerOpenings?.length ? (
        <>
          <h3>Cash drawer opened</h3>
          <ul className="changes">
            {s.drawerOpenings.map((d) => (
              <li key={d.id}>
                {indianTime(d.at)} {d.kind === "no_sale" ? "No sale, approved by a manager" : "With a sale"}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {s.status === "closed" ? (
        <>
          <h3>In the accounts</h3>
          <LedgerEntryButton documentType="pos_shift" documentId={s.id} inline />
        </>
      ) : null}
    </>
  );
}

function SyncProblems() {
  const { user } = useAuth();
  const canResolve = posRights(user).shiftManage;
  const [all, setAll] = useState(false);
  const rows = useLoad(() => api.get<SyncProblemRow[]>(`/pos/reports/sync-problems${query({ all: all ? "true" : undefined })}`), [all]);
  const [resolving, setResolving] = useState<SyncProblemRow | null>(null);
  const [posting, setPosting] = useState<SyncProblemRow | null>(null);
  const [posted, setPosted] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Audit 5 (C3): the bill goes into the till's open shift, with its stock and accounts, flagged "posted by the office". */
  async function post() {
    if (!posting) return;
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<{ sale: { number: string } | null; return: { number: string } | null }>(`/pos/sync-problems/${posting.id}/post`, {});
      setPosted(`Bill ${[r.return?.number, r.sale?.number].filter(Boolean).join(" and ")} was posted into the till's open shift.`);
      setPosting(null);
      await rows.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resolve() {
    if (!resolving) return;
    setError(null);
    if (!reason.trim()) {
      setError("Say what was done about it.");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/pos/sync-problems/${resolving.id}/resolve`, { reason: reason.trim() });
      setResolving(null);
      await rows.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: ReportColumn<SyncProblemRow>[] = [
    { key: "created", header: "When", value: (r) => formatDateTime(r.createdAt) },
    { key: "till", header: "Till", value: (r) => r.till ?? "" },
    { key: "kind", header: "What", value: (r) => r.kind },
    { key: "error", header: "Problem", value: (r) => r.error },
    { key: "resolved", header: "Resolved", value: (r) => (r.resolvedAt ? `${formatDateTime(r.resolvedAt)}: ${r.resolution ?? ""}` : "") , render: (r) => (r.resolvedAt ? `${formatDateTime(r.resolvedAt)} — ${r.resolution ?? ""}` : <Badge kind="warn">Open</Badge>) },
    ...(canResolve
      ? ([
          {
            key: "actions",
            header: "",
            value: () => "",
            render: (r: SyncProblemRow) =>
              r.resolvedAt ? null : (
                <span className="row-actions">
                  {r.kind === "bill" ? (
                    <Button
                      size="small"
                      variant="primary"
                      onClick={() => {
                        setError(null);
                        setPosted(null);
                        setPosting(r);
                      }}
                    >
                      Post into shift
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    onClick={() => {
                      setReason("");
                      setError(null);
                      setPosted(null);
                      setResolving(r);
                    }}
                  >
                    Mark resolved
                  </Button>
                </span>
              ),
          },
        ] satisfies ReportColumn<SyncProblemRow>[])
      : []),
  ];

  return (
    <>
      <p className="muted">
        Bills or shift records a till sent that the server could not save. The sale happened, so fix the cause if needed (for example add the missing price) and post the bill into the till&apos;s open shift: its stock and accounts are then
        recorded and it is listed on &quot;Offline bills to check&quot;.
      </p>
      {posted ? <Alert kind="success">{posted}</Alert> : null}
      <CheckInput id="sync-all" label="Show resolved problems too" checked={all} onChange={(e) => setAll(e.target.checked)} />
      <ReportTable name="sync-problems" columns={columns} rows={rows.data} error={rows.error} loading={rows.loading} rowKey={(r) => r.id} empty="No sync problems." />
      <Dialog open={posting !== null} title="Post into shift" onClose={() => setPosting(null)}>
        {posting ? <p className="muted">{posting.error}</p> : null}
        <p>The bill is saved as the till sent it, into the till&apos;s open shift, with its stock and accounts. It is marked &quot;posted by the office&quot; and listed on &quot;Offline bills to check&quot;.</p>
        <Alert kind="error">{error}</Alert>
        <div className="actions">
          <Button variant="primary" busy={busy} onClick={() => void post()}>
            Post into shift
          </Button>
          <Button onClick={() => setPosting(null)}>Cancel</Button>
        </div>
      </Dialog>
      <Dialog open={resolving !== null} title="Mark resolved" onClose={() => setResolving(null)}>
        {resolving ? <p className="muted">{resolving.error}</p> : null}
        {resolving?.kind === "bill" ? (
          <Alert kind="info">
            <strong>Marking it resolved does not save the bill: the sale will NOT reach stock and the accounts.</strong> Use &quot;Post into shift&quot; to record it, or enter it again by hand.
          </Alert>
        ) : null}
        <Alert kind="error">{error}</Alert>
        <TextareaInput id="sync-reason" label="What was done" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="actions">
          <Button variant="primary" busy={busy} onClick={() => void resolve()}>
            Mark resolved
          </Button>
          <Button onClick={() => setResolving(null)}>Cancel</Button>
        </div>
      </Dialog>
    </>
  );
}
