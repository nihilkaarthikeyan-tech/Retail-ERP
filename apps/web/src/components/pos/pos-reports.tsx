// Copyright (c) 2026, Rademics. All rights reserved.
// Till reports (plan 06 §1 item 12; decision 66): each with a table and a CSV download.
"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { LedgerEntryButton } from "@/components/accounts/ledger-entry";
import { Alert, Badge, Button, CheckInput, DataTable, Dialog, SelectInput, TextareaInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime } from "@/lib/format";
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
}

/** One report column: what the table shows and what goes into the CSV file. */
interface ReportColumn<T> {
  key: string;
  header: string;
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
}

type Tab = "register" | "payments" | "hourly" | "by-cashier" | "shifts" | "offline-check" | "sync-problems";

const TABS: { id: Tab; label: string }[] = [
  { id: "register", label: "Till register" },
  { id: "payments", label: "Payments by method" },
  { id: "hourly", label: "Hourly sales" },
  { id: "by-cashier", label: "Sales per cashier" },
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

const OFFLINE: ReportColumn<OfflineRow>[] = [
  { key: "number", header: "Bill", value: (r) => r.number, render: (r) => <Link href={`/pos/bills/${r.id}`} className="mono">{r.number}</Link> },
  { key: "soldAt", header: "Sold", value: (r) => formatDateTime(r.soldAt) },
  { key: "till", header: "Till", value: (r) => r.till },
  { key: "offline", header: "Offline", value: (r) => (r.offline ? "Yes" : "No") },
  { key: "flags", header: "To check", value: (r) => flagsText(r.flags), render: (r) => <FlagBadges flags={r.flags} /> },
  { key: "total", header: "Total", align: "right", value: (r) => r.total, render: (r) => rupees(r.total) },
];

/** The seven till reports. */
export function PosReports() {
  const tills = useTills();
  const [tab, setTab] = useState<Tab>("register");
  const [filters, setFilters] = useState({ from: "", to: "", tillId: "" });

  return (
    <>
      <h1>Till reports</h1>
      <div className="tabs" role="tablist" aria-label="Reports">
        {TABS.map((t) => (
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
          </div>
        ) : null}
        {tab === "sync-problems" ? <SyncProblems /> : <ReportBody key={tab} tab={tab} params={query(filters)} />}
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
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
                <Button
                  size="small"
                  onClick={() => {
                    setReason("");
                    setError(null);
                    setResolving(r);
                  }}
                >
                  Mark resolved
                </Button>
              ),
          },
        ] satisfies ReportColumn<SyncProblemRow>[])
      : []),
  ];

  return (
    <>
      <p className="muted">Bills or shift records a till sent that the server could not save. Fix the cause (for example add the missing price), then mark the problem resolved.</p>
      <CheckInput id="sync-all" label="Show resolved problems too" checked={all} onChange={(e) => setAll(e.target.checked)} />
      <ReportTable name="sync-problems" columns={columns} rows={rows.data} error={rows.error} loading={rows.loading} rowKey={(r) => r.id} empty="No sync problems." />
      <Dialog open={resolving !== null} title="Mark resolved" onClose={() => setResolving(null)}>
        {resolving ? <p className="muted">{resolving.error}</p> : null}
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
