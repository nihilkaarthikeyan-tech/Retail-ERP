// Copyright (c) 2026, Rademics. All rights reserved.
// The dashboards on the home page (plan 09 §1.1 and §6.1): one tab per
// dashboard the user may see, each with headline tiles and small charts. The
// chosen tab is remembered on this computer.
"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { hasPermission } from "shared";
import { useOrderStores } from "@/components/purchasing/orders-shared";
import { Alert, Button, SelectInput } from "@/components/ui";
import { api, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { DASHBOARD_AREAS, DASHBOARD_LABELS, type DashboardDto, type DashboardName, formatWorkedOut, monthLabel, shortDate, type ValueKind } from "@/lib/reports";
import { useLoad } from "@/lib/use-load";
import { BarChart, ColumnChart, type Datum, LineChart, type SeriesDatum, seriesFor, SINGLE_COLOR } from "./charts";
import { TileGrid } from "./tiles";

const TAB_STORAGE_KEY = "retail-erp.dashboard-tab";

function readStoredTab(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(TAB_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeTab(tab: string) {
  try {
    window.localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // Private windows may refuse storage; the tab is then simply not remembered.
  }
}

type Form = "bars" | "columns" | "line" | "stacked" | "grouped";

interface ChartSpec {
  title: string;
  note?: string;
  kind: ValueKind;
  form: Form;
  xLabel?: (label: string) => string;
  labelHeader?: string;
  valueHeader?: string;
  empty?: string;
}

/** Plain titles for the charts each dashboard sends (apps/api/src/reports/dashboards.service.ts). */
const CHARTS: Record<string, ChartSpec> = {
  salesByHour: { title: "Sales by hour today", note: "Before GST, Indian time", kind: "money", form: "columns", labelHeader: "Hour", empty: "No sales yet today." },
  salesLast30Days: { title: "Sales over the last 30 days", note: "Before GST", kind: "money", form: "line", xLabel: shortDate, valueHeader: "Net sales" },
  paymentMix: { title: "Payments received today, by method", kind: "money", form: "bars", labelHeader: "Method", valueHeader: "Amount", empty: "No payments yet today." },
  topItemsThisWeek: { title: "Top 10 items this week", note: "By quantity sold", kind: "quantity", form: "bars", labelHeader: "Item", valueHeader: "Quantity sold", empty: "Nothing sold this week yet." },
  salesByStoreByMonth: { title: "Sales by store per month", note: "Before GST", kind: "money", form: "stacked", xLabel: monthLabel, labelHeader: "Month" },
  marginByGroup: { title: "Gross margin by item group this month", kind: "percent", form: "bars", labelHeader: "Item group", valueHeader: "Gross margin", empty: "Nothing sold this month yet." },
  stockValueByMonth: { title: "Stock value at each month end", note: "From the stock accounts", kind: "money", form: "line", xLabel: shortDate, valueHeader: "Stock value" },
  customerDuesByAge: { title: "What customers owe, by age", note: "Days past the due date", kind: "money", form: "columns", labelHeader: "Age", empty: "No customer owes anything." },
  purchasesBySupplier30Days: { title: "Purchases by supplier, last 30 days", note: "Supplier bills, before GST", kind: "money", form: "bars", labelHeader: "Supplier", valueHeader: "Purchases", empty: "No supplier bills in the last 30 days." },
  reorderSuggestionsByGroup: { title: "Open reorder suggestions by item group", kind: "count", form: "bars", labelHeader: "Item group", valueHeader: "Suggestions", empty: "No open reorder suggestions." },
  incomeVsExpensesByMonth: { title: "Income and expenses by month", note: "From the accounts", kind: "money", form: "grouped", xLabel: monthLabel, labelHeader: "Month" },
  cashFlowThisMonth: { title: "Cash in and out this month", note: "Money in less money out, by kind", kind: "money", form: "bars", labelHeader: "Kind", valueHeader: "Net cash", empty: "No cash moved this month." },
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (v === null || v === undefined ? "0" : String(v));

/** "salesByHour" → "Sales by hour" for a chart this screen does not know yet. */
function titleFromKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One chart of a dashboard, drawn in the form that suits its data. */
function DashboardChart({ name, raw }: { name: string; raw: unknown }) {
  if (!Array.isArray(raw)) return null;
  const spec: ChartSpec = CHARTS[name] ?? { title: titleFromKey(name), kind: "money", form: "bars" };
  const items = raw.filter(isObject);

  // Income and expenses arrive as { month, income, expenses, net }.
  if (items.some((i) => "month" in i && "income" in i)) {
    const data: SeriesDatum[] = items.map((i) => ({ label: String(i.month), values: { income: str(i.income), expenses: str(i.expenses) } }));
    const series = [
      { key: "income", label: "Income", color: "var(--chart-1)" },
      { key: "expenses", label: "Expenses", color: "var(--chart-2)" },
    ];
    return <ColumnChart title={spec.title} note={spec.note} data={data} series={series} mode="grouped" kind={spec.kind} xLabel={spec.xLabel} labelHeader={spec.labelHeader} emptyText={spec.empty} />;
  }

  // Several series per period, as { label, values: { MAIN: "…", ANNA: "…" } } (sales by store by month).
  if (items.some((i) => isObject(i.values))) {
    const data: SeriesDatum[] = items.map((i) => ({ label: String(i.label), values: Object.fromEntries(Object.entries(i.values as Record<string, unknown>).map(([k, v]) => [k, str(v)])) }));
    // Each store keeps its colour: series in the order of their codes, not by size.
    const keys = [...new Set(data.flatMap((d) => Object.keys(d.values)))].sort();
    const { series, data: folded } = seriesFor(keys, data);
    return <ColumnChart title={spec.title} note={spec.note} data={folded} series={series} mode={spec.form === "grouped" ? "grouped" : "stacked"} kind={spec.kind} xLabel={spec.xLabel} labelHeader={spec.labelHeader} emptyText={spec.empty} legendAlways />;
  }

  const data: Datum[] = items.map((i) => ({ label: String(i.label ?? ""), value: str(i.value) }));
  if (spec.form === "line") return <LineChart title={spec.title} note={spec.note} data={data} kind={spec.kind} xLabel={spec.xLabel} labelHeader={spec.labelHeader} valueHeader={spec.valueHeader} emptyText={spec.empty} />;
  if (spec.form === "columns") {
    return (
      <ColumnChart
        title={spec.title}
        note={spec.note}
        data={data.map((d) => ({ label: d.label, values: { value: d.value } }))}
        series={[{ key: "value", label: spec.valueHeader ?? "Value", color: SINGLE_COLOR }]}
        kind={spec.kind}
        xLabel={spec.xLabel}
        labelHeader={spec.labelHeader}
        emptyText={spec.empty}
      />
    );
  }
  return <BarChart title={spec.title} note={spec.note} data={data} kind={spec.kind} labelHeader={spec.labelHeader} valueHeader={spec.valueHeader} emptyText={spec.empty} />;
}

/** The dashboard tabs; nothing for users who may see none. */
export function Dashboards() {
  const { user } = useAuth();
  const canAny = hasPermission(user, "pos.reports") || hasPermission(user, "purchase.view") || hasPermission(user, "accounts.view");
  const list = useLoad(() => (canAny ? api.get<{ dashboards: DashboardName[] }>("/dashboards") : Promise.resolve({ dashboards: [] as DashboardName[] })), [canAny]);
  const [chosen, setChosen] = useState<string | null>(readStoredTab);
  const names = list.data?.dashboards ?? [];
  const tab = names.find((n) => n === chosen) ?? names[0];

  if (!canAny) return null;
  if (list.error) return <Alert kind="error">{list.error}</Alert>;
  if (!list.data) return <p className="muted">Loading the dashboards…</p>;
  if (!tab) return null;

  return (
    <section className="dashboards" aria-label="Dashboards">
      {names.length > 1 ? (
        <div className="tabs" role="tablist" aria-label="Dashboards">
          {names.map((n) => (
            <button
              key={n}
              type="button"
              role="tab"
              id={`dash-tab-${n}`}
              aria-selected={tab === n}
              aria-controls="dash-panel"
              className="tab"
              onClick={() => {
                setChosen(n);
                storeTab(n);
              }}
            >
              {DASHBOARD_LABELS[n] ?? n}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" id="dash-panel" aria-labelledby={names.length > 1 ? `dash-tab-${tab}` : undefined} aria-label={names.length > 1 ? undefined : `${DASHBOARD_LABELS[tab]} dashboard`}>
        <DashboardPanel key={tab} name={tab} />
      </div>
    </section>
  );
}

function DashboardPanel({ name }: { name: DashboardName }) {
  const { stores } = useOrderStores();
  const [storeId, setStoreId] = useState("");
  const path = `/dashboards/${name}${name === "store" ? query({ storeId }) : ""}`;
  const d = useLoad(() => api.get<DashboardDto>(path), [path]);
  const area = DASHBOARD_AREAS[name] ?? "sales";

  let body: ReactNode;
  if (d.error && !d.data) body = <Alert kind="error">{d.error}</Alert>;
  else if (!d.data) body = <p className="muted">Working out the figures…</p>;
  else
    body = (
      <>
        <Alert kind="error">{d.error}</Alert>
        <TileGrid tiles={d.data.tiles} />
        <div className="dash-charts">
          {Object.entries(d.data.charts).map(([key, raw]) => (
            <DashboardChart key={key} name={key} raw={raw} />
          ))}
        </div>
      </>
    );

  return (
    <div className={`area-${area} dash-panel${d.loading && d.data ? " is-refreshing" : ""}`} aria-busy={d.loading || undefined}>
      <div className="dash-bar">
        <p className="muted">
          {d.data ? (
            <>
              Figures for {formatDate(d.data.date)} · Worked out at {formatWorkedOut(d.data.workedOutAt)}
            </>
          ) : null}
        </p>
        <span className="spacer" />
        {name === "store" && stores.length > 1 ? (
          <SelectInput id="dash-store" label="Store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">All my stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </SelectInput>
        ) : null}
        <Button size="small" busy={d.loading && !!d.data} onClick={() => void d.reload()}>
          Refresh
        </Button>
      </div>
      {body}
      <p className="dash-more">
        <Link href="/reports">All reports</Link>
      </p>
    </div>
  );
}
