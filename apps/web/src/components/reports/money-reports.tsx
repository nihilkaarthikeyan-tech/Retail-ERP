// Copyright (c) 2026, Rademics. All rights reserved.
// Cash and bank position, and the cash flow statement (plan 09 §1.2 and §3),
// both read from the accounts (decision 51).
"use client";

import type { PermissionKey } from "shared";
import { Alert } from "@/components/ui";
import { query } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { CashFlowDto, CashFlowSection, CashPositionDto } from "@/lib/reports";
import { Amount, col, csvName, DateFilter, periodText, ReportPage, type ReportColumn, ReportTable, StoreFilter, storeName, tableCsv, useAllowed, useReport, useReportStores, useUrlFilters } from "./report-kit";

const ACCOUNTS: PermissionKey[] = ["accounts.view"];
const monthStart = (today: string) => `${today.slice(0, 7)}-01`;

// ---- Cash and bank position ----

type PositionRow = CashPositionDto["rows"][number];

export function CashPositionReport() {
  const f = useUrlFilters({ asOf: (t) => t, storeId: "" });
  const v = f.values;
  const stores = useReportStores();
  const access = useAllowed(ACCOUNTS);
  const r = useReport<CashPositionDto>(`/reports/cash-position${query({ asOf: v.asOf, storeId: v.storeId })}`, f.ready && access.allowed);
  const columns = (d: CashPositionDto): ReportColumn<PositionRow>[] => [
    { ...col.text<PositionRow>("account", "Account", (x) => (x.number ? `${x.number} ${x.name}` : x.name)), wide: true },
    col.text<PositionRow>("kind", "Kind", (x) => x.kind),
    col.text<PositionRow>("store", "Store", (x) => x.store),
    col.money<PositionRow>("balance", "Balance", (x) => x.balance, d.total),
  ];
  return (
    <ReportPage
      id="cash-position"
      area="accounts"
      needs={ACCOUNTS}
      ready={f.ready}
      state={r}
      note="Balances from the accounts at the end of the day. Till accounts hold cash from closed shifts that has not been moved to cash in hand or the bank yet."
      filters={
        <>
          <DateFilter id="rf-asof" label="As on" value={v.asOf} onChange={(x) => f.set({ asOf: x })} />
          <StoreFilter stores={stores} value={v.storeId} onChange={(x) => f.set({ storeId: x })} />
        </>
      }
      summary={`As on ${formatDate(v.asOf)} · ${storeName(stores, v.storeId)}`}
      logFilters={{ asOn: v.asOf, store: storeName(stores, v.storeId) }}
      csv={(d) => tableCsv(columns(d), d.rows, true)}
      fileName={csvName("cash-and-bank-position", v.asOf)}
    >
      {(d) => <ReportTable columns={columns(d)} rows={d.rows} rowKey={(x) => x.accountId} empty="No cash, till or bank accounts to show." />}
    </ReportPage>
  );
}

// ---- Cash flow ----

interface FlowLine {
  kind: "opening" | "heading" | "account" | "subtotal" | "net" | "closing";
  section: string;
  label: string;
  amount: string | null;
}

const SECTIONS: { key: "trading" | "investing" | "financing" | "transfers"; label: string; hint: string }[] = [
  { key: "trading", label: "Trading", hint: "sales, purchases, customers, suppliers, expenses, tax and stock" },
  { key: "investing", label: "Investing", hint: "fixed assets and investments" },
  { key: "financing", label: "Financing", hint: "capital, drawings and loans" },
  { key: "transfers", label: "To or from accounts outside this view", hint: "for example cash taken to the company's bank" },
];

function flowLines(d: CashFlowDto): FlowLine[] {
  const out: FlowLine[] = [{ kind: "opening", section: "", label: "Cash and bank at the start", amount: d.opening }];
  for (const s of SECTIONS) {
    const section: CashFlowSection = d[s.key];
    // Moves between accounts the viewer cannot see appear only when there are any.
    if (s.key === "transfers" && section.rows.length === 0) continue;
    out.push({ kind: "heading", section: s.label, label: `${s.label} (${s.hint})`, amount: null });
    for (const r of section.rows) out.push({ kind: "account", section: s.label, label: r.name, amount: r.amount });
    out.push({ kind: "subtotal", section: s.label, label: `Total ${s.label.toLowerCase()}`, amount: section.total });
  }
  out.push({ kind: "net", section: "", label: "Change in cash and bank", amount: d.netChange });
  out.push({ kind: "closing", section: "", label: "Cash and bank at the end", amount: d.closing });
  return out;
}

const FLOW_COLUMNS: ReportColumn<FlowLine>[] = [
  { key: "section", header: "Section", value: (x) => x.section, render: () => null },
  {
    key: "label",
    header: "",
    value: (x) => x.label,
    render: (x) => (x.kind === "account" ? <span className="report-indent">{x.label}</span> : <strong>{x.label}</strong>),
  },
  { key: "amount", header: "Amount", align: "right", value: (x) => x.amount ?? "", render: (x) => (x.amount === null ? null : x.kind === "account" ? <Amount value={x.amount} /> : <strong><Amount value={x.amount} /></strong>) },
];

export function CashFlowReport() {
  const f = useUrlFilters({ from: monthStart, to: (t) => t, storeId: "" });
  const v = f.values;
  const stores = useReportStores();
  const access = useAllowed(ACCOUNTS);
  const r = useReport<CashFlowDto>(`/reports/cash-flow${query({ from: v.from, to: v.to, storeId: v.storeId })}`, f.ready && access.allowed);
  // On screen the section column is folded into the headings; the CSV keeps it.
  const screen = FLOW_COLUMNS.filter((c) => c.key !== "section").map((c) => (c.key === "label" ? { ...c, header: "What" } : c));
  return (
    <ReportPage
      id="cash-flow"
      area="accounts"
      needs={ACCOUNTS}
      ready={f.ready}
      state={r}
      note="Each movement in a cash, till or bank account is put under the kind of account on the other side. Money moved between the shop's own cash and bank accounts is left out, so the start plus the three totals equals the end. Money in is shown as a plus, money out as a minus."
      filters={
        <>
          <DateFilter id="rf-from" label="From" value={v.from} onChange={(x) => f.set({ from: x })} />
          <DateFilter id="rf-to" label="To" value={v.to} onChange={(x) => f.set({ to: x })} />
          <StoreFilter stores={stores} value={v.storeId} onChange={(x) => f.set({ storeId: x })} />
        </>
      }
      summary={`${periodText(v.from, v.to)} · ${storeName(stores, v.storeId)}`}
      logFilters={{ from: v.from, to: v.to, store: storeName(stores, v.storeId) }}
      csv={(d) => {
        const lines = flowLines(d);
        return { ...tableCsv(FLOW_COLUMNS.map((c) => (c.key === "label" ? { ...c, header: "What" } : c)), lines, false), count: lines.length };
      }}
      fileName={csvName("cash-flow", v.from, "to", v.to)}
    >
      {(d) => (
        <>
          {!d.agrees ? <Alert kind="error">The start plus the movements does not equal the end. Please tell your accountant; an entry may be missing an account.</Alert> : null}
          <div className="table-wrap">
            <table className="table report-table">
              <thead>
                <tr>
                  {screen.map((c) => (
                    <th key={c.key} scope="col" className={c.align === "right" ? "num" : undefined}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flowLines(d).map((x, i) => (
                  <tr key={i} className={x.kind === "account" ? undefined : `report-flow-${x.kind}`}>
                    {screen.map((c) => (
                      <td key={c.key} className={c.align === "right" ? "num" : undefined}>
                        {c.render ? c.render(x) : c.value(x)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ReportPage>
  );
}
