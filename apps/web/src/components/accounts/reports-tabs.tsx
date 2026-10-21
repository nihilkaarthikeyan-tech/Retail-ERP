// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { PrintButton } from "@/components/documents/print-button";
import { PartyPicker } from "@/components/parties/party-picker";
import { reportCsv, type ReportColumn } from "@/components/purchasing/reports-tabs";
import { useOrderStores } from "@/components/purchasing/orders-shared";
import { Alert, Badge, Button, CheckInput, SelectInput, TextInput } from "@/components/ui";
import { api, query } from "@/lib/api";
import { type AccountDto, accountRights, type CashBookDto, documentHref, documentLabel, fyStart, type PartyKind } from "@/lib/accounts";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { useModules } from "@/lib/modules";
import { downloadCsv, rupees } from "@/lib/purchasing";
import { useBusinessToday } from "@/lib/stock";
import type { PartyRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { AccountSelect, useChart, usePartyNames } from "./accounts-shared";

// ---- Report shapes (apps/api/src/accounting/ledger-reports.service.ts) ----

export interface LedgerRow {
  id: string;
  date: string;
  account: string;
  accountId: string;
  documentType: string;
  documentId: string;
  documentNumber: string | null;
  party: string | null;
  partyType: string | null;
  store: string | null;
  debit: string;
  credit: string;
  balance: string;
  remark: string | null;
  cancelled: boolean;
}

export interface GeneralLedgerDto {
  opening: string;
  /** Balance just before this page's first line. */
  pageOpening?: string;
  page?: number;
  pageSize?: number;
  total?: number;
  rows: LedgerRow[];
  totals: { debit: string; credit: string; closing: string };
}

interface DayBookEntry {
  id: string;
  date: string;
  documentType: string;
  documentId: string;
  documentNumber: string | null;
  store: string | null;
  remark: string | null;
  isCancellation: boolean;
  lines: { account: string; party: string | null; store: string | null; debit: string; credit: string; remark: string | null }[];
}

interface TrialRow {
  accountId: string;
  number: string | null;
  name: string;
  family: string;
  openingDebit: string;
  openingCredit: string;
  debit: string;
  credit: string;
  closingDebit: string;
  closingCredit: string;
}

interface TrialBalanceDto {
  rows: TrialRow[];
  totals: Record<"openingDebit" | "openingCredit" | "debit" | "credit" | "closingDebit" | "closingCredit", string>;
  balanced: boolean;
}

interface PnlSection {
  rows: { accountId: string; number: string | null; name: string; amounts: Record<string, string>; total: string }[];
  totals: Record<string, string>;
  total: string;
}

interface ProfitAndLossDto {
  periods: string[];
  income: PnlSection;
  expenses: PnlSection;
  net: Record<string, string>;
  netTotal: string;
}

interface BsFamily {
  rows: { accountId: string; number: string | null; name: string; amount: string }[];
  total: string;
}

interface BalanceSheetDto {
  asOf: string;
  assets: BsFamily;
  liabilities: BsFamily;
  equity: BsFamily;
  profitNotClosed: string;
  totalLiabilitiesAndCapital: string;
  balanced: boolean;
}

export interface StatementDto {
  opening: string;
  rows: LedgerRow[];
  closing: string;
  openItems: { itemType: string; itemId: string; number: string | null; date: string; dueDate: string | null; amount: string; owed: string }[];
}

interface AgeingDto {
  asOf: string;
  partyType: PartyKind;
  labels: string[];
  rows: { partyId: string; name: string | null; bands: Record<string, string>; owed: string; unused: string; net: string }[];
  totals: Record<string, string>;
  unused: string;
}

interface StockVsAccountsDto {
  rows: { key: string; name: string; stockValue: string; accounts: string; difference: string }[];
  ok: boolean;
}

interface BookHealthDto {
  totalDebit: string;
  totalCredit: string;
  partiesChecked: number;
  problems: string[];
  ok: boolean;
}

// ---- Tabs ----

export type AccountsReportTab = "general-ledger" | "day-book" | "cash-book" | "bank-book" | "trial-balance" | "profit-and-loss" | "balance-sheet" | "statement" | "ageing" | "stock-vs-accounts" | "book-health";

export const ACCOUNTS_REPORT_TABS: { id: AccountsReportTab; label: string; viewOnly: boolean }[] = [
  { id: "general-ledger", label: "General ledger", viewOnly: true },
  { id: "day-book", label: "Day book", viewOnly: true },
  { id: "cash-book", label: "Cash book", viewOnly: true },
  { id: "bank-book", label: "Bank book", viewOnly: true },
  { id: "trial-balance", label: "Trial balance", viewOnly: true },
  { id: "profit-and-loss", label: "Profit and loss", viewOnly: true },
  { id: "balance-sheet", label: "Balance sheet", viewOnly: true },
  { id: "statement", label: "Customer / supplier statement", viewOnly: false },
  { id: "ageing", label: "Ageing", viewOnly: false },
  { id: "stock-vs-accounts", label: "Stock against accounts", viewOnly: true },
  { id: "book-health", label: "Book health", viewOnly: true },
];

/** Blank for zero, so debit and credit columns read easily. */
const amt = (v: string | null | undefined) => (!v || v === "0.00" ? "" : rupees(v));
const neg = (v: string | null | undefined) => (v?.startsWith("-") ? "num-negative" : undefined);

function DocLink({ type, id, number }: { type: string; id: string; number: string | null }) {
  const href = documentHref(type, id);
  const text = `${documentLabel(type)}${number ? ` ${number}` : ""}`;
  return href ? <Link href={href}>{text}</Link> : <>{text}</>;
}

/** A report table with an optional footer and a CSV download of the same columns. */
function ReportTable<T>({ name, columns, rows, rowKey, empty, footer, rowClassName }: { name: string; columns: ReportColumn<T>[]; rows: T[]; rowKey: (row: T, i: number) => string; empty: string; footer?: ReactNode; rowClassName?: (row: T) => string | undefined }) {
  return (
    <>
      <div className="toolbar">
        <span className="muted">{`${rows.length} row${rows.length === 1 ? "" : "s"}`}</span>
        <span className="spacer" />
        <Button size="small" disabled={rows.length === 0} onClick={() => downloadCsv(`accounts-${name}.csv`, reportCsv(columns, rows))}>
          Download for Excel (CSV)
        </Button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={c.align === "right" ? "num" : undefined}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="muted">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={rowKey(r, i)} className={rowClassName?.(r)}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.align === "right" ? "num" : undefined}>
                      {c.render ? c.render(r) : (c.value(r) ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {footer ? <tfoot>{footer}</tfoot> : null}
        </table>
      </div>
    </>
  );
}

function Loaded<T>({ state, children }: { state: { data: T | null; error: string | null; loading: boolean }; children: (data: T) => ReactNode }) {
  if (state.error) return <Alert kind="error">{state.error}</Alert>;
  if (!state.data) return <p className="muted">Loading…</p>;
  return <>{children(state.data)}</>;
}

interface Filters {
  from: string;
  to: string;
  asOf: string;
  storeId: string;
  accountId: string;
  showZero: boolean;
  byMonth: boolean;
  includeCancelled: boolean;
  /** Cash book and bank book: the account chosen (blank = the first one). */
  cashAccountId: string;
  bankAccountId: string;
  partyType: PartyKind;
  /** undefined: the party named in the link (if any); null: none chosen. */
  party: PartyRef | null | undefined;
}

// ---- Each report ----

/** "Lines 1,001–2,000 of 6,000" with Previous / Next; ledgers are long, so they come a page at a time. */
function Pages({ page, pageSize, total, noun, onPage }: { page: number; pageSize: number; total: number; noun: string; onPage: (p: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const fmt = (n: number) => n.toLocaleString("en-IN");
  return (
    <div className="toolbar">
      <span className="muted">
        {noun} {fmt((page - 1) * pageSize + 1)}–{fmt(Math.min(total, page * pageSize))} of {fmt(total)}
      </span>
      <span className="spacer" />
      <Button size="small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <Button size="small" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  );
}

const ledgerColumns = (withAccount: boolean, withParty: boolean): ReportColumn<LedgerRow>[] => [
  { key: "date", header: "Date", value: (r) => r.date, render: (r) => formatDate(r.date) },
  { key: "doc", header: "Document", value: (r) => `${documentLabel(r.documentType)} ${r.documentNumber ?? ""}`.trim(), render: (r) => <DocLink type={r.documentType} id={r.documentId} number={r.documentNumber} /> },
  ...(withAccount ? ([{ key: "account", header: "Account", value: (r) => r.account }] satisfies ReportColumn<LedgerRow>[]) : []),
  ...(withParty ? ([{ key: "party", header: "Customer / supplier", value: (r) => r.party ?? "" }] satisfies ReportColumn<LedgerRow>[]) : []),
  { key: "store", header: "Store", value: (r) => r.store ?? "" },
  { key: "remark", header: "Remark", value: (r) => r.remark ?? "" },
  { key: "debit", header: "Debit", align: "right", value: (r) => r.debit, render: (r) => amt(r.debit) },
  { key: "credit", header: "Credit", align: "right", value: (r) => r.credit, render: (r) => amt(r.credit) },
  { key: "balance", header: "Balance", align: "right", value: (r) => r.balance, render: (r) => <span className={neg(r.balance)}>{rupees(r.balance)}</span> },
];

function GeneralLedger({ f }: { f: Filters }) {
  const filters = query({ from: f.from, to: f.to, storeId: f.storeId, accountId: f.accountId, includeCancelled: f.includeCancelled ? "true" : undefined });
  const [paging, setPaging] = useState({ filters, page: 1 });
  const page = paging.filters === filters ? paging.page : 1;
  const q = query({ from: f.from, to: f.to, storeId: f.storeId, accountId: f.accountId, includeCancelled: f.includeCancelled ? "true" : undefined, page: page > 1 ? String(page) : undefined });
  const gl = useLoad(() => api.get<GeneralLedgerDto>(`/reports/general-ledger${q}`), [q]);
  return (
    <Loaded state={gl}>
      {(d) => (
        <>
          <p>
            Balance before {formatDate(f.from)}: <strong className={neg(d.opening)}>{rupees(d.opening)}</strong> (debit minus credit)
            {d.pageOpening && page > 1 ? (
              <>
                {" "}
                · balance before this page: <strong className={neg(d.pageOpening)}>{rupees(d.pageOpening)}</strong>
              </>
            ) : null}
          </p>
          <Pages page={page} pageSize={d.pageSize ?? d.rows.length} total={d.total ?? d.rows.length} noun="Lines" onPage={(p) => setPaging({ filters, page: p })} />
          <ReportTable
            name="general-ledger"
            columns={ledgerColumns(true, true)}
            rows={d.rows}
            rowKey={(r) => r.id}
            empty="Nothing posted in this period."
            rowClassName={(r) => (r.cancelled ? "row-muted" : undefined)}
            footer={
              <tr>
                <td colSpan={6}>
                  <strong>Totals and closing balance</strong>
                </td>
                <td className="num">{rupees(d.totals.debit)}</td>
                <td className="num">{rupees(d.totals.credit)}</td>
                <td className={`num ${neg(d.totals.closing) ?? ""}`}>{rupees(d.totals.closing)}</td>
              </tr>
            }
          />
        </>
      )}
    </Loaded>
  );
}

type DayBookRow = DayBookEntry["lines"][number] & { entry: DayBookEntry; first: boolean; key: string };

function DayBook({ f }: { f: Filters }) {
  const filters = query({ from: f.from, to: f.to, storeId: f.storeId });
  const [paging, setPaging] = useState({ filters, page: 1 });
  const page = paging.filters === filters ? paging.page : 1;
  const q = query({ from: f.from, to: f.to, storeId: f.storeId, page: page > 1 ? String(page) : undefined });
  const book = useLoad(() => api.get<{ rows: DayBookEntry[]; total: number; page: number; pageSize: number }>(`/reports/day-book${q}`), [q]);
  const columns: ReportColumn<DayBookRow>[] = [
    { key: "date", header: "Date", value: (r) => r.entry.date, render: (r) => (r.first ? formatDate(r.entry.date) : "") },
    {
      key: "doc",
      header: "Document",
      value: (r) => `${documentLabel(r.entry.documentType)} ${r.entry.documentNumber ?? ""}`.trim(),
      render: (r) =>
        r.first ? (
          <>
            <DocLink type={r.entry.documentType} id={r.entry.documentId} number={r.entry.documentNumber} /> {r.entry.isCancellation ? <Badge kind="off">Cancellation</Badge> : null}
          </>
        ) : (
          ""
        ),
    },
    { key: "account", header: "Account", value: (r) => r.account },
    { key: "party", header: "Customer / supplier", value: (r) => r.party ?? "" },
    { key: "store", header: "Store", value: (r) => r.store ?? "" },
    { key: "debit", header: "Debit", align: "right", value: (r) => r.debit, render: (r) => amt(r.debit) },
    { key: "credit", header: "Credit", align: "right", value: (r) => r.credit, render: (r) => amt(r.credit) },
    { key: "remark", header: "Remark", value: (r) => r.remark ?? (r.first ? (r.entry.remark ?? "") : "") },
  ];
  return (
    <Loaded state={book}>
      {(d) => (
        <>
          <Pages page={page} pageSize={d.pageSize} total={d.total} noun="Entries" onPage={(p) => setPaging({ filters, page: p })} />
          <ReportTable name="day-book" columns={columns} rows={d.rows.flatMap((e) => e.lines.map((l, i) => ({ ...l, entry: e, first: i === 0, key: `${e.id}-${i}` })))} rowKey={(r) => r.key} empty="Nothing posted in this period." />
        </>
      )}
    </Loaded>
  );
}

/**
 * Cash book or bank book (plan 11 C8): day by day, opening, money in, money out
 * and closing, then every entry with its running balance, a page at a time.
 * The closing balance is checked against the ledger.
 */
function CashBook({ f, accountId, book }: { f: Filters; accountId: string; book: "cash" | "bank" }) {
  const filters = query({ from: f.from, to: f.to, accountId, includeCancelled: f.includeCancelled ? "true" : undefined });
  const [paging, setPaging] = useState({ filters, page: 1 });
  const page = paging.filters === filters ? paging.page : 1;
  const q = query({ from: f.from, to: f.to, accountId, includeCancelled: f.includeCancelled ? "true" : undefined, page: page > 1 ? String(page) : undefined });
  const cb = useLoad(() => api.get<CashBookDto>(`/reports/cash-book${q}`), [q]);
  const name = book === "bank" ? "bank-book" : "cash-book";
  type Day = CashBookDto["days"][number];
  type Row = CashBookDto["rows"][number];
  const dayColumns: ReportColumn<Day>[] = [
    { key: "date", header: "Date", value: (r) => r.date, render: (r) => formatDate(r.date) },
    { key: "opening", header: "Opening", align: "right", value: (r) => r.opening, render: (r) => <span className={neg(r.opening)}>{rupees(r.opening)}</span> },
    { key: "in", header: "Money in", align: "right", value: (r) => r.moneyIn, render: (r) => amt(r.moneyIn) },
    { key: "out", header: "Money out", align: "right", value: (r) => r.moneyOut, render: (r) => amt(r.moneyOut) },
    { key: "closing", header: "Closing", align: "right", value: (r) => r.closing, render: (r) => <span className={neg(r.closing)}>{rupees(r.closing)}</span> },
  ];
  const rowColumns: ReportColumn<Row>[] = [
    { key: "date", header: "Date", value: (r) => r.date, render: (r) => formatDate(r.date) },
    { key: "doc", header: "Document", value: (r) => `${documentLabel(r.documentType)} ${r.documentNumber ?? ""}`.trim(), render: (r) => <DocLink type={r.documentType} id={r.documentId} number={r.documentNumber} /> },
    { key: "against", header: "Against", value: (r) => r.against },
    { key: "store", header: "Store", value: (r) => r.store ?? "" },
    { key: "remark", header: "Remark", value: (r) => r.remark ?? "" },
    { key: "in", header: "Money in", align: "right", value: (r) => r.moneyIn, render: (r) => amt(r.moneyIn) },
    { key: "out", header: "Money out", align: "right", value: (r) => r.moneyOut, render: (r) => amt(r.moneyOut) },
    { key: "balance", header: "Balance", align: "right", value: (r) => r.balance, render: (r) => <span className={neg(r.balance)}>{rupees(r.balance)}</span> },
  ];
  return (
    <Loaded state={cb}>
      {(d) => (
        <>
          <dl className="kv" aria-label={book === "bank" ? "Bank book totals" : "Cash book totals"}>
            <dt>Opening on {formatDate(d.from)}</dt>
            <dd className={neg(d.opening)}>{rupees(d.opening)}</dd>
            <dt>Money in</dt>
            <dd>{rupees(d.moneyIn)}</dd>
            <dt>Money out</dt>
            <dd>{rupees(d.moneyOut)}</dd>
            <dt>Closing on {formatDate(d.to)}</dt>
            <dd className={neg(d.closing)}>
              <strong>{rupees(d.closing)}</strong>
            </dd>
          </dl>
          <p>
            {d.matchesLedger ? <Badge kind="ok">Closing balance matches the ledger</Badge> : <Badge kind="off">{`The ledger shows ${rupees(d.ledgerClosing)}: tell the Accountant`}</Badge>}
            {d.limitedToStores ? <span className="muted"> Only your stores&apos; entries are shown.</span> : null}
          </p>
          <h3>Day by day</h3>
          <ReportTable name={`${name}-days`} columns={dayColumns} rows={d.days} rowKey={(r) => r.date} empty="No money in or out in this period." />
          <h3>Entries</h3>
          <Pages page={page} pageSize={d.pageSize} total={d.total} noun="Entries" onPage={(p) => setPaging({ filters, page: p })} />
          {page > 1 ? (
            <p className="muted">
              Balance before this page: <strong className={neg(d.pageOpening)}>{rupees(d.pageOpening)}</strong>
            </p>
          ) : null}
          <ReportTable name={name} columns={rowColumns} rows={d.rows} rowKey={(r) => r.id} empty="No entries in this period." rowClassName={(r) => (r.cancelled ? "row-muted" : undefined)} />
        </>
      )}
    </Loaded>
  );
}

/** The cash account a user would look at first: the cash in hand of one of their stores. */
function firstCashAccount(accounts: AccountDto[], storeIds: string[] | null): string {
  const cash = accounts.filter((a) => !a.isGroup && a.kind === "cash");
  const mine = (a: AccountDto) => !a.storeId || !storeIds || storeIds.includes(a.storeId);
  return (cash.find((a) => a.systemKey?.startsWith("cash_in_hand:") && mine(a)) ?? cash.find(mine) ?? cash[0])?.id ?? "";
}

function TrialBalance({ f }: { f: Filters }) {
  const q = query({ from: f.from, to: f.to, storeId: f.storeId, showZero: f.showZero ? "true" : undefined });
  const tb = useLoad(() => api.get<TrialBalanceDto>(`/reports/trial-balance${q}`), [q]);
  const columns: ReportColumn<TrialRow>[] = [
    { key: "number", header: "Number", value: (r) => r.number ?? "" },
    { key: "name", header: "Account", value: (r) => r.name },
    { key: "od", header: "Opening debit", align: "right", value: (r) => r.openingDebit, render: (r) => amt(r.openingDebit) },
    { key: "oc", header: "Opening credit", align: "right", value: (r) => r.openingCredit, render: (r) => amt(r.openingCredit) },
    { key: "d", header: "Debits in period", align: "right", value: (r) => r.debit, render: (r) => amt(r.debit) },
    { key: "c", header: "Credits in period", align: "right", value: (r) => r.credit, render: (r) => amt(r.credit) },
    { key: "cd", header: "Closing debit", align: "right", value: (r) => r.closingDebit, render: (r) => amt(r.closingDebit) },
    { key: "cc", header: "Closing credit", align: "right", value: (r) => r.closingCredit, render: (r) => amt(r.closingCredit) },
  ];
  return (
    <Loaded state={tb}>
      {(d) => (
        <>
          <p>{d.balanced ? <Badge kind="ok">Debits equal credits</Badge> : <Badge kind="off">Debits and credits differ: tell the Accountant</Badge>}</p>
          <ReportTable
            name="trial-balance"
            columns={columns}
            rows={d.rows}
            rowKey={(r) => r.accountId}
            empty="No balances in this period."
            footer={
              <tr>
                <td colSpan={2}>
                  <strong>Totals</strong>
                </td>
                {(["openingDebit", "openingCredit", "debit", "credit", "closingDebit", "closingCredit"] as const).map((k) => (
                  <td key={k} className="num">
                    <strong>{rupees(d.totals[k])}</strong>
                  </td>
                ))}
              </tr>
            }
          />
        </>
      )}
    </Loaded>
  );
}

const monthName = (p: string) => (p === "total" ? "Amount" : new Date(Date.UTC(+p.slice(0, 4), +p.slice(5, 7) - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }));

type PnlRow = { key: string; label: string; amounts: Record<string, string>; total: string; strong?: boolean };

function ProfitAndLoss({ f }: { f: Filters }) {
  const q = query({ from: f.from, to: f.to, storeId: f.storeId, groupBy: f.byMonth ? "month" : undefined });
  const pnl = useLoad(() => api.get<ProfitAndLossDto>(`/reports/profit-and-loss${q}`), [q]);
  return (
    <Loaded state={pnl}>
      {(d) => {
        const monthly = d.periods.length > 1 || d.periods[0] !== "total";
        const section = (title: string, s: PnlSection): PnlRow[] => [
          ...s.rows.map((r) => ({ key: r.accountId, label: `${r.number ? `${r.number} ` : ""}${r.name}`, amounts: r.amounts, total: r.total })),
          { key: `total-${title}`, label: `Total ${title.toLowerCase()}`, amounts: s.totals, total: s.total, strong: true },
        ];
        const rows: PnlRow[] = [
          { key: "h-income", label: "Income", amounts: {}, total: "", strong: true },
          ...section("Income", d.income),
          { key: "h-expenses", label: "Expenses", amounts: {}, total: "", strong: true },
          ...section("Expenses", d.expenses),
          { key: "net", label: d.netTotal.startsWith("-") ? "Net loss" : "Net profit", amounts: d.net, total: d.netTotal, strong: true },
        ];
        const columns: ReportColumn<PnlRow>[] = [
          { key: "label", header: "Account", value: (r) => r.label, render: (r) => (r.strong ? <strong>{r.label}</strong> : r.label) },
          ...(monthly ? d.periods.map((p) => ({ key: p, header: monthName(p), align: "right" as const, value: (r: PnlRow) => r.amounts[p] ?? "", render: (r: PnlRow) => <span className={neg(r.amounts[p])}>{r.amounts[p] ? rupees(r.amounts[p]) : ""}</span> })) : []),
          { key: "total", header: monthly ? "Total" : "Amount", align: "right", value: (r) => r.total, render: (r) => <span className={neg(r.total)}>{r.total ? rupees(r.total) : ""}</span> },
        ];
        return <ReportTable name="profit-and-loss" columns={columns} rows={rows} rowKey={(r) => r.key} empty="No income or expenses." />;
      }}
    </Loaded>
  );
}

type BsRow = { key: string; label: string; amount: string; strong?: boolean };

function BalanceSheet({ f }: { f: Filters }) {
  const q = query({ asOf: f.asOf, storeId: f.storeId });
  const bs = useLoad(() => api.get<BalanceSheetDto>(`/reports/balance-sheet${q}`), [q]);
  const columns: ReportColumn<BsRow>[] = [
    { key: "label", header: "Account", value: (r) => r.label, render: (r) => (r.strong ? <strong>{r.label}</strong> : r.label) },
    { key: "amount", header: "Amount", align: "right", value: (r) => r.amount, render: (r) => <span className={neg(r.amount)}>{r.amount ? rupees(r.amount) : ""}</span> },
  ];
  return (
    <Loaded state={bs}>
      {(d) => {
        const fam = (title: string, s: BsFamily): BsRow[] => [
          { key: `h-${title}`, label: title, amount: "", strong: true },
          ...s.rows.map((r) => ({ key: r.accountId, label: `${r.number ? `${r.number} ` : ""}${r.name}`, amount: r.amount })),
          { key: `t-${title}`, label: `Total ${title.toLowerCase()}`, amount: s.total, strong: true },
        ];
        const rows: BsRow[] = [
          ...fam("What the shop owns (assets)", d.assets),
          ...fam("What the shop owes (liabilities)", d.liabilities),
          ...fam("Capital and reserves", d.equity),
          { key: "profit", label: "Profit not yet closed into capital", amount: d.profitNotClosed },
          { key: "total-lc", label: "Total liabilities and capital", amount: d.totalLiabilitiesAndCapital, strong: true },
        ];
        return (
          <>
            <p>{d.balanced ? <Badge kind="ok">Assets equal liabilities and capital</Badge> : <Badge kind="off">Does not balance: tell the Accountant</Badge>}</p>
            <ReportTable name="balance-sheet" columns={columns} rows={rows} rowKey={(r) => r.key} empty="Nothing to show." />
          </>
        );
      }}
    </Loaded>
  );
}

function Statement({ f }: { f: Filters }) {
  const party = f.party;
  const q = query({ from: f.from, to: f.to });
  const st = useLoad<StatementDto | null>(() => (party ? api.get<StatementDto>(`/reports/party-statement/${f.partyType}/${party.id}${q}`) : Promise.resolve(null)), [f.partyType, party?.id, q]);
  if (!party) return <p className="muted">Choose a {f.partyType} above.</p>;
  const owedWord = f.partyType === "customer" ? "owes us" : "we owe";
  return (
    <Loaded state={st}>
      {(d) =>
        d ? (
          <>
            <p>
              Before {formatDate(f.from)}: <strong>{rupees(d.opening)}</strong> ({owedWord}). Now: <strong className={neg(d.closing)}>{rupees(d.closing)}</strong> ({owedWord}; a minus means the other way round).
            </p>
            <div className="toolbar">
              <PrintButton kind="statement" id={`${f.partyType}:${party.id}`} label="Print statement" />
              <span className="muted">The printed statement lists every entry to date, with the bills still unpaid.</span>
            </div>
            <ReportTable name={`statement-${party.code}`} columns={ledgerColumns(false, false)} rows={d.rows} rowKey={(r) => r.id} empty="Nothing in this period." />
            <h3>Unpaid bills and unused payments today</h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Document</th>
                    <th scope="col">Date</th>
                    <th scope="col">Due</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col" className="num">
                      Still open
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.openItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        Nothing open.
                      </td>
                    </tr>
                  ) : (
                    d.openItems.map((i) => (
                      <tr key={`${i.itemType}|${i.itemId}`}>
                        <td>
                          <DocLink type={i.itemType} id={i.itemId} number={i.number} />
                        </td>
                        <td>{formatDate(i.date)}</td>
                        <td>{formatDate(i.dueDate)}</td>
                        <td className="num">{rupees(i.amount)}</td>
                        <td className={`num ${neg(i.owed) ?? ""}`}>{rupees(i.owed)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null
      }
    </Loaded>
  );
}

function Ageing({ f }: { f: Filters }) {
  const q = query({ asOf: f.asOf, storeId: f.storeId, partyType: f.partyType });
  const ag = useLoad(() => api.get<AgeingDto>(`/reports/ageing${q}`), [q]);
  return (
    <Loaded state={ag}>
      {(d) => {
        type Row = AgeingDto["rows"][number];
        const columns: ReportColumn<Row>[] = [
          { key: "name", header: d.partyType === "customer" ? "Customer" : "Supplier", value: (r) => r.name ?? "", render: (r) => <Link href={`/${d.partyType === "customer" ? "customers" : "suppliers"}/${r.partyId}`}>{r.name ?? "—"}</Link> },
          ...d.labels.map((l) => ({ key: l, header: l === "Not due" ? l : `${l} days`, align: "right" as const, value: (r: Row) => r.bands[l], render: (r: Row) => amt(r.bands[l]) })),
          { key: "owed", header: "Total owed", align: "right", value: (r) => r.owed, render: (r) => rupees(r.owed) },
          { key: "unused", header: "Unused payments", align: "right", value: (r) => r.unused, render: (r) => amt(r.unused) },
          { key: "net", header: "Net", align: "right", value: (r) => r.net, render: (r) => <strong>{rupees(r.net)}</strong> },
        ];
        return (
          <ReportTable
            name={`ageing-${d.partyType}`}
            columns={columns}
            rows={d.rows}
            rowKey={(r) => r.partyId}
            empty="Nothing is owed."
            footer={
              <tr>
                <td>
                  <strong>Totals</strong>
                </td>
                {d.labels.map((l) => (
                  <td key={l} className="num">
                    {rupees(d.totals[l])}
                  </td>
                ))}
                <td colSpan={2} className="num">
                  Unused: {rupees(d.unused)}
                </td>
                <td />
              </tr>
            }
          />
        );
      }}
    </Loaded>
  );
}

function StockVsAccounts() {
  const sv = useLoad(() => api.get<StockVsAccountsDto>("/reports/stock-vs-accounts"));
  type Row = StockVsAccountsDto["rows"][number];
  const columns: ReportColumn<Row>[] = [
    { key: "name", header: "Store", value: (r) => r.name },
    { key: "stock", header: "Stock value (inventory)", align: "right", value: (r) => r.stockValue, render: (r) => rupees(r.stockValue) },
    { key: "books", header: "Stock in the accounts", align: "right", value: (r) => r.accounts, render: (r) => rupees(r.accounts) },
    { key: "diff", header: "Difference", align: "right", value: (r) => r.difference, render: (r) => <span className={r.difference === "0.00" ? undefined : "num-negative"}>{rupees(r.difference)}</span> },
  ];
  return (
    <Loaded state={sv}>
      {(d) => (
        <>
          <p>{d.ok ? <Badge kind="ok">Stock and accounts agree</Badge> : <Badge kind="off">There is a difference: tell the Accountant</Badge>} The value of stock on the shelves should equal the stock accounts for every store.</p>
          <ReportTable name="stock-vs-accounts" columns={columns} rows={d.rows} rowKey={(r) => r.key} empty="No stock yet." />
        </>
      )}
    </Loaded>
  );
}

function BookHealth() {
  const bh = useLoad(() => api.get<BookHealthDto>("/reports/book-health"));
  return (
    <Loaded state={bh}>
      {(d) => (
        <section className="card" aria-label="Book health">
          <p>{d.ok ? <Badge kind="ok">The books are healthy</Badge> : <Badge kind="off">Problems found</Badge>}</p>
          <dl className="kv">
            <dt>All debits</dt>
            <dd>{rupees(d.totalDebit)}</dd>
            <dt>All credits</dt>
            <dd>{rupees(d.totalCredit)}</dd>
            <dt>Customers and suppliers checked</dt>
            <dd>{d.partiesChecked}</dd>
          </dl>
          {d.problems.length ? (
            <ul>
              {d.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Debits equal credits, and every customer&apos;s and supplier&apos;s balance matches their unpaid bills less unused payments.</p>
          )}
          <div className="toolbar">
            <Button size="small" onClick={() => downloadCsv("accounts-book-health.csv", reportCsv<string>([{ key: "p", header: "Problem", value: (p) => p }], d.problems.length ? d.problems : ["No problems"]))}>
              Download for Excel (CSV)
            </Button>
          </div>
        </section>
      )}
    </Loaded>
  );
}

// ---- The page ----

const TAB_FILTERS: Record<AccountsReportTab, ("period" | "asOf" | "store" | "account" | "cashAccount" | "bankAccount" | "showZero" | "byMonth" | "cancelled" | "partyType" | "party")[]> = {
  "general-ledger": ["period", "store", "account", "cancelled"],
  "day-book": ["period", "store"],
  "cash-book": ["period", "cashAccount", "cancelled"],
  "bank-book": ["period", "bankAccount", "cancelled"],
  "trial-balance": ["period", "store", "showZero"],
  "profit-and-loss": ["period", "store", "byMonth"],
  "balance-sheet": ["asOf", "store"],
  statement: ["period", "partyType", "party"],
  ageing: ["asOf", "store", "partyType"],
  "stock-vs-accounts": [],
  "book-health": [],
};

/** The accounts reports, each with a "Download for Excel (CSV)" button. */
export function AccountsReports() {
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const rights = accountRights(user);
  const chart = useChart();
  const { stores } = useOrderStores();
  // Plan 12: the cash and bank books belong to "Expenses and cash book".
  const booksOn = useModules().isOn("expenses");
  const tabs = ACCOUNTS_REPORT_TABS.filter((t) => (rights.view || (!t.viewOnly && rights.payments)) && (booksOn || (t.id !== "cash-book" && t.id !== "bank-book")));
  const requested = params.get("tab") as AccountsReportTab | null;
  const [chosenTab, setTab] = useState<AccountsReportTab | null>(requested);
  // The rights are known once the user has loaded; a tab the user may not see falls back to the first allowed.
  const tab: AccountsReportTab = chosenTab && tabs.some((t) => t.id === chosenTab) ? chosenTab : (tabs[0]?.id ?? "general-ledger");
  const startPartyType: PartyKind = params.get("partyType") === "supplier" ? "supplier" : "customer";
  const startPartyId = params.get("partyId");
  const names = usePartyNames([{ type: startPartyType, id: startPartyId }]);
  const today = useBusinessToday();
  const [f, setF] = useState<Filters>({ from: "", to: "", asOf: "", storeId: "", accountId: "", showZero: false, byMonth: true, includeCancelled: false, cashAccountId: "", bankAccountId: "", partyType: startPartyType, party: undefined });
  // A statement link from a customer or supplier page names the party by id only.
  const party = f.party !== undefined ? f.party : startPartyId ? (names[startPartyId] ?? null) : null;
  // Blank dates mean: from the start of this financial year, up to today (Indian business dates).
  const filters = { ...f, party, from: f.from || fyStart(today), to: f.to || today, asOf: f.asOf || today };
  const show = new Set(TAB_FILTERS[tab]);
  const accounts = chart.data?.accounts ?? [];
  const cashAccounts = accounts.filter((a) => !a.isGroup && a.kind === "cash");
  const bankAccounts = accounts.filter((a) => !a.isGroup && a.kind === "bank");
  const cashAccountId = f.cashAccountId || firstCashAccount(accounts, user && !user.allStores && !user.isOwnerAdmin ? user.stores.map((s) => s.id) : null);
  const bankAccountId = f.bankAccountId || (bankAccounts[0]?.id ?? "");
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));

  if (loading) return <p className="muted">Loading…</p>;
  if (tabs.length === 0) return <Alert kind="error">You do not have the right to see the accounts reports.</Alert>;

  return (
    <>
      <h1>Accounts reports</h1>
      <div className="tabs" role="tablist" aria-label="Reports">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} className="tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {show.size ? (
          <div className="filter-row">
            {show.has("period") ? (
              <>
                <TextInput id="acr-from" label="From" type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} />
                <TextInput id="acr-to" label="To" type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} />
              </>
            ) : null}
            {show.has("asOf") ? <TextInput id="acr-asof" label="As on" type="date" value={filters.asOf} onChange={(e) => set("asOf", e.target.value)} /> : null}
            {show.has("partyType") ? (
              <SelectInput id="acr-party-type" label="Customers or suppliers" value={f.partyType} onChange={(e) => setF((x) => ({ ...x, partyType: e.target.value as PartyKind, party: null }))}>
                <option value="customer">Customers</option>
                <option value="supplier">Suppliers</option>
              </SelectInput>
            ) : null}
            {show.has("party") ? <PartyPicker id="acr-party" label={f.partyType === "customer" ? "Customer" : "Supplier"} kind={f.partyType} value={party} onChange={(p) => set("party", p)} /> : null}
            {show.has("store") ? (
              <SelectInput id="acr-store" label="Store" value={f.storeId} onChange={(e) => set("storeId", e.target.value)}>
                <option value="">All my stores</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </SelectInput>
            ) : null}
            {show.has("cashAccount") ? (
              <SelectInput id="acr-cash-account" label="Cash account" value={cashAccountId} onChange={(e) => set("cashAccountId", e.target.value)} hint="Each store's cash in hand, or its till drawer.">
                {cashAccounts.length === 0 ? <option value="">No cash accounts yet</option> : null}
                {cashAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </SelectInput>
            ) : null}
            {show.has("bankAccount") ? (
              <SelectInput id="acr-bank-account" label="Bank account" value={bankAccountId} onChange={(e) => set("bankAccountId", e.target.value)}>
                {bankAccounts.length === 0 ? <option value="">No bank accounts yet</option> : null}
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.number ? `${a.number} ${a.name}` : a.name}
                  </option>
                ))}
              </SelectInput>
            ) : null}
            {show.has("account") ? <AccountSelect id="acr-account" label="Account or folder" accounts={chart.data?.accounts ?? []} value={f.accountId} onChange={(v) => set("accountId", v)} placeholder="All accounts" /> : null}
            {show.has("showZero") ? <CheckInput id="acr-zero" label="Show accounts with nothing on them" checked={f.showZero} onChange={(e) => set("showZero", e.target.checked)} /> : null}
            {show.has("byMonth") ? <CheckInput id="acr-month" label="Month by month" checked={f.byMonth} onChange={(e) => set("byMonth", e.target.checked)} /> : null}
            {show.has("cancelled") ? <CheckInput id="acr-cancelled" label="Include cancelled entries" checked={f.includeCancelled} onChange={(e) => set("includeCancelled", e.target.checked)} /> : null}
          </div>
        ) : null}
        {!today ? <p className="muted">Loading…</p> : null}
        {today && tab === "general-ledger" ? <GeneralLedger f={filters} /> : null}
        {today && tab === "day-book" ? <DayBook f={filters} /> : null}
        {today && tab === "cash-book" ? cashAccountId ? <CashBook f={filters} accountId={cashAccountId} book="cash" /> : <p className="muted">{chart.data ? "No cash accounts yet." : "Loading…"}</p> : null}
        {today && tab === "bank-book" ? bankAccountId ? <CashBook f={filters} accountId={bankAccountId} book="bank" /> : <p className="muted">{chart.data ? "No bank accounts yet. Add one under Bank accounts." : "Loading…"}</p> : null}
        {today && tab === "trial-balance" ? <TrialBalance f={filters} /> : null}
        {today && tab === "profit-and-loss" ? <ProfitAndLoss f={filters} /> : null}
        {today && tab === "balance-sheet" ? <BalanceSheet f={filters} /> : null}
        {today && tab === "statement" ? <Statement f={filters} /> : null}
        {today && tab === "ageing" ? <Ageing f={filters} /> : null}
        {tab === "stock-vs-accounts" ? <StockVsAccounts /> : null}
        {tab === "book-health" ? <BookHealth /> : null}
      </div>
    </>
  );
}
