// Copyright (c) 2026, Rademics. All rights reserved.
// The same tools on every module 9 report (plan 09 §1.4): filters with
// sensible defaults kept in the address bar, a table with a totals row and the
// time it was worked out, Download for Excel (CSV, recorded in the history)
// and Print / save as PDF with the company name and address at the top.
"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { hasPermission, type PermissionKey } from "shared";
import { useOrderStores } from "@/components/purchasing/orders-shared";
import { Alert, Button, SelectInput, TextInput } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import type { MenuArea } from "@/lib/menu";
import { useModules } from "@/lib/modules";
import { rupees } from "@/lib/purchasing";
import { type CsvCell, downloadReport, formatWorkedOut, type LogFilters, percentText, reportEntry, reportQuestion } from "@/lib/reports";
import { isNegative, showQuantity, useBusinessToday } from "@/lib/stock";
import type { BrandDto, CompanyDto, ItemGroupNode, StoreRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { forFilter, pickLabel } from "@/lib/pick";

// ---- Filters kept in the address bar ----

type Defaults<K extends string> = Record<K, string | ((today: string) => string)>;

/**
 * Filter values read from the query string, falling back to defaults (which
 * may depend on today's Indian business date). Changing a filter replaces the
 * address, so a report can be bookmarked or shared as it is.
 */
export function useUrlFilters<K extends string>(defaults: Defaults<K>) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const today = useBusinessToday();
  const fallback = (k: K) => {
    const d = defaults[k];
    // Date defaults wait for today's date, which is read in the browser only.
    return typeof d === "function" ? (today ? d(today) : "") : d;
  };
  const values = Object.fromEntries((Object.keys(defaults) as K[]).map((k) => [k, params.get(k) ?? fallback(k)])) as Record<K, string>;
  function set(patch: Partial<Record<K, string>>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch) as [K, string][]) {
      if (v === fallback(k) || v === undefined) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }
  return { values, set, today, ready: today !== "" };
}

/** Whether the user holds any of the rights a report needs (the API checks again). */
export function useAllowed(anyOf: PermissionKey[]): { allowed: boolean; checking: boolean } {
  const { user, loading } = useAuth();
  return { allowed: anyOf.some((k) => hasPermission(user, k)), checking: loading };
}

/** Loads a report once the filters are known and the user may see it. */
export function useReport<T>(path: string, ready: boolean) {
  return useLoad<T | null>(() => (ready ? api.get<T>(path) : Promise.resolve(null)), [path, ready]);
}

// ---- Filter controls ----

export function DateFilter({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return <TextInput id={id} label={label} type="date" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />;
}

/** The stores this user may see; the store filter shows only when there is a choice. */
export function useReportStores() {
  return useOrderStores().stores;
}

export function storeName(stores: StoreRef[], id: string): string {
  if (!id) return "All my stores";
  const s = stores.find((x) => x.id === id);
  return s ? `${s.code} — ${s.name}` : "One store";
}

export function StoreFilter({ stores, value, onChange }: { stores: StoreRef[]; value: string; onChange: (v: string) => void }) {
  if (stores.length < 2 && !value) return null;
  return (
    <SelectInput id="rf-store" label="Store" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All my stores</option>
      {stores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.code} — {s.name}
        </option>
      ))}
    </SelectInput>
  );
}

export interface Option {
  id: string;
  label: string;
}

/** Item groups that hold items (the lowest level), named with their path: "Grocery › Staples › Rice". */
export function useItemGroupOptions(): Option[] {
  const { user } = useAuth();
  const can = hasPermission(user, "catalogue.view");
  const tree = useLoad<ItemGroupNode[]>(() => (can ? api.get<ItemGroupNode[]>("/catalogue/item-groups") : Promise.resolve([])), [can]);
  const out: Option[] = [];
  const walk = (nodes: ItemGroupNode[], path: string[]) => {
    for (const n of nodes) {
      const here = [...path, n.name];
      if (n.isLeaf) out.push({ id: n.id, label: here.join(" › ") });
      walk(n.children, here);
    }
  };
  walk(tree.data ?? [], []);
  return out;
}

export function useBrandOptions(): Option[] {
  const { user } = useAuth();
  const can = hasPermission(user, "catalogue.view");
  const brands = useLoad<BrandDto[]>(() => (can ? api.get<BrandDto[]>("/catalogue/brands") : Promise.resolve([])), [can]);
  return forFilter(brands.data ?? []).map((b) => ({ id: b.id, label: pickLabel(b.name, b) }));
}

export function OptionFilter({ id, label, all, options, value, onChange }: { id: string; label: string; all: string; options: Option[]; value: string; onChange: (v: string) => void }) {
  if (options.length === 0 && !value) return null;
  return (
    <SelectInput id={id} label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{all}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </SelectInput>
  );
}

export const optionLabel = (options: Option[], id: string, all: string) => (id ? (options.find((o) => o.id === id)?.label ?? "One chosen") : all);

// ---- Cells ----

/** A rupee amount, red when below zero. */
export function Amount({ value }: { value: string | null | undefined }) {
  return <span className={isNegative(value) ? "num-negative" : undefined}>{rupees(value)}</span>;
}

/** A quantity without trailing zeros, red when below zero. */
export function Qty({ value }: { value: string | null | undefined }) {
  return <span className={isNegative(value) ? "num-negative" : undefined}>{showQuantity(value)}</span>;
}

// ---- Columns and the table ----

export interface ReportColumn<T> {
  key: string;
  header: string;
  /** The plain value written to the CSV file. */
  value: (row: T) => CsvCell;
  /** What the table shows; the plain value when left out. */
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Keep the cell on one line (dates). Numbers never wrap. */
  nowrap?: boolean;
  /** A name column that should not be squeezed to a few letters a line. */
  wide?: boolean;
  /** The totals row: the plain value for the CSV and what the table shows. */
  total?: { value: CsvCell; show?: ReactNode };
}

/** Column builders for the usual kinds of figure. */
export const col = {
  text<T>(key: string, header: string, get: (r: T) => string | null | undefined, render?: (r: T) => ReactNode): ReportColumn<T> {
    return { key, header, value: (r) => get(r) ?? "", render: render ?? ((r) => get(r) ?? "—") };
  },
  date<T>(key: string, header: string, get: (r: T) => string | null | undefined): ReportColumn<T> {
    return { key, header, nowrap: true, value: (r) => get(r) ?? "", render: (r) => formatDate(get(r)) };
  },
  money<T>(key: string, header: string, get: (r: T) => string | null | undefined, total?: string | null): ReportColumn<T> {
    return { key, header, align: "right", value: (r) => get(r) ?? "", render: (r) => <Amount value={get(r)} />, ...(total !== undefined ? { total: { value: total ?? "", show: <Amount value={total} /> } } : {}) };
  },
  qty<T>(key: string, header: string, get: (r: T) => string | null | undefined, total?: string | null): ReportColumn<T> {
    return { key, header, align: "right", value: (r) => get(r) ?? "", render: (r) => <Qty value={get(r)} />, ...(total !== undefined ? { total: { value: total ?? "", show: <Qty value={total} /> } } : {}) };
  },
  count<T>(key: string, header: string, get: (r: T) => number, total?: number): ReportColumn<T> {
    return { key, header, align: "right", value: (r) => get(r), ...(total !== undefined ? { total: { value: total } } : {}) };
  },
  percent<T>(key: string, header: string, get: (r: T) => string | null | undefined, total?: string | null): ReportColumn<T> {
    return { key, header, align: "right", value: (r) => get(r) ?? "", render: (r) => <span className={isNegative(get(r)) ? "num-negative" : undefined}>{percentText(get(r))}</span>, ...(total !== undefined ? { total: { value: total ?? "", show: percentText(total) } } : {}) };
  },
};

/** CSV rows for a report table: the same columns as on screen, then the totals row. */
export function tableCsv<T>(columns: ReportColumn<T>[], rows: T[], withTotals: boolean): { headers: string[]; rows: CsvCell[][]; count: number } {
  const body = rows.map((r) => columns.map((c) => c.value(r)));
  const totals = withTotals && columns.some((c) => c.total) ? [columns.map((c, i) => (c.total ? c.total.value : i === 0 ? "Total" : ""))] : [];
  return { headers: columns.map((c) => c.header), rows: [...body, ...totals], count: rows.length };
}

const cellClass = <T,>(c: ReportColumn<T>) => [c.align === "right" ? "num" : "", c.nowrap ? "nowrap" : "", c.wide ? "wide" : ""].filter(Boolean).join(" ") || undefined;

export function ReportTable<T>({ columns, rows, rowKey, empty, totals = true, totalLabel = "Total", caption }: { columns: ReportColumn<T>[]; rows: T[]; rowKey: (row: T, i: number) => string; empty: string; totals?: boolean; totalLabel?: string; caption?: string }) {
  const showTotals = totals && rows.length > 0 && columns.some((c) => c.total);
  return (
    <div className="table-wrap">
      <table className="table report-table">
        {caption ? <caption>{caption}</caption> : null}
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
              <tr key={rowKey(r, i)}>
                {columns.map((c) => (
                  <td key={c.key} className={cellClass(c)}>
                    {c.render ? c.render(r) : (c.value(r) ?? "—")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {showTotals ? (
          <tfoot>
            <tr className="report-totals">
              {columns.map((c, i) => (
                <td key={c.key} className={cellClass(c)}>
                  {c.total ? (c.total.show ?? c.total.value) : i === 0 ? totalLabel : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

// ---- The page frame ----

/** The company name and address for the top of a printed report (decision 65). */
function usePrintHeading() {
  const { user } = useAuth();
  const can = hasPermission(user, "company.view");
  const company = useLoad<CompanyDto | null>(() => (can ? api.get<CompanyDto>("/company") : Promise.resolve(null)), [can]);
  const c = company.data;
  if (!c) return null;
  const address = [c.addressLine1, c.addressLine2, [c.city, c.pincode].filter(Boolean).join(" ")].filter((p) => p && p.trim()).join(", ");
  return { name: c.tradeName ?? c.legalName, legalName: c.tradeName ? c.legalName : null, address, phone: c.phone };
}

export interface CsvOutput {
  headers: string[];
  rows: CsvCell[][];
  count: number;
}

interface ReportPageProps<D extends { workedOutAt: string }> {
  /** The report's id in the report centre (title and question come from there). */
  id: string;
  area: MenuArea;
  needs: PermissionKey[];
  filters: ReactNode;
  /** The filters in words, for the printed page and the history. */
  summary: string;
  logFilters: LogFilters;
  ready: boolean;
  state: { data: D | null; error: string | null; loading: boolean };
  csv: (data: D) => CsvOutput;
  fileName: string;
  /** A short note under the question, for example "Net sales are before GST." */
  note?: ReactNode;
  children: (data: D) => ReactNode;
}

export function ReportPage<D extends { workedOutAt: string }>({ id, area, needs, filters, summary, logFilters, ready, state, csv, fileName, note, children }: ReportPageProps<D>) {
  const entry = reportEntry(id);
  const { modules } = useModules();
  const access = useAllowed(needs);
  const heading = usePrintHeading();
  const [saving, setSaving] = useState(false);
  const data = state.data;

  async function download() {
    if (!data) return;
    setSaving(true);
    const out = csv(data);
    await downloadReport(fileName, out.headers, out.rows, { report: entry.title, filters: logFilters, rows: out.count });
    setSaving(false);
  }

  if (access.checking) return <p className="muted">Loading…</p>;
  if (!access.allowed) {
    return (
      <div className={`area-${area}`}>
        <h1>{entry.title}</h1>
        <Alert kind="error">You do not have the right to see this report. Ask the owner if you need it.</Alert>
      </div>
    );
  }

  return (
    <div className={`area-${area} report-print`}>
      {/* A report is printed on ordinary paper, not the till's 80 mm receipt roll. */}
      <style>{"@media print { @page { size: auto; margin: 12mm; } }"}</style>
      {heading ? (
        <div className="report-print-only report-company">
          <strong>{heading.name}</strong>
          {heading.legalName ? <span> ({heading.legalName})</span> : null}
          {heading.address ? <div>{heading.address}</div> : null}
          {heading.phone ? <div>Phone {heading.phone}</div> : null}
        </div>
      ) : null}
      <p className="report-crumbs report-no-print">
        <Link href="/reports">All reports</Link>
      </p>
      <h1>{entry.title}</h1>
      <p className="muted report-question">{reportQuestion(entry, modules)}</p>
      {note ? <p className="report-note">{note}</p> : null}
      <p className="report-print-only report-summary">{summary}</p>
      <div className="filter-row report-no-print">{filters}</div>
      <Alert kind="error">{state.error}</Alert>
      {!ready || (!data && !state.error) ? <p className="muted">Working out the report…</p> : null}
      {data ? (
        <>
          <div className={`toolbar report-no-print${state.loading ? " is-refreshing" : ""}`}>
            <span className="muted">Worked out at {formatWorkedOut(data.workedOutAt)}</span>
            <span className="spacer" />
            <Button size="small" busy={saving} onClick={() => void download()}>
              Download for Excel (CSV)
            </Button>
            <Button size="small" onClick={() => window.print()}>
              Print / save as PDF
            </Button>
          </div>
          <div className={state.loading ? "is-refreshing" : undefined}>{children(data)}</div>
          <p className="report-print-only muted">Worked out at {formatWorkedOut(data.workedOutAt)}</p>
        </>
      ) : null}
    </div>
  );
}

/** "1 Oct 2026 to 16 Oct 2026". */
export function periodText(from: string, to: string): string {
  return from === to ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`;
}

/** Sort-safe file name part: "daily-sales-2026-10-10-to-2026-10-16.csv". */
export function csvName(slug: string, ...parts: string[]): string {
  return `${[slug, ...parts.filter(Boolean)].join("-")}.csv`;
}
