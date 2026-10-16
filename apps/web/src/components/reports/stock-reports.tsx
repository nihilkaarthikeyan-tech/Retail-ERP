// Copyright (c) 2026, Rademics. All rights reserved.
// Stock analysis reports (plan 09 §1.2): stock movement for a period, stock
// cover and sell-through, stock age, and stock variance and loss. Value
// columns appear only when the API sends them (decision 70).
"use client";

import Link from "next/link";
import { addDays, Decimal, type PermissionKey } from "shared";
import { Badge, SelectInput } from "@/components/ui";
import { query } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { percentText, type ShrinkageDto, type StockAgeDto, type StockCoverDto, type StockCoverRow, type StockMovementDto, type StockMovementRow } from "@/lib/reports";
import { showQuantity } from "@/lib/stock";
import {
  Amount,
  col,
  csvName,
  DateFilter,
  OptionFilter,
  optionLabel,
  periodText,
  Qty,
  ReportPage,
  type ReportColumn,
  ReportTable,
  StoreFilter,
  storeName,
  tableCsv,
  useAllowed,
  useItemGroupOptions,
  useReport,
  useReportStores,
  useUrlFilters,
} from "./report-kit";

const STOCK: PermissionKey[] = ["stock.view"];
const COST: PermissionKey[] = ["stock.cost.view", "cost_price.view"];
const monthStart = (today: string) => `${today.slice(0, 7)}-01`;

const itemColumns = <T extends { code: string | null; name: string; unit: string | null }>(): ReportColumn<T>[] => [
  { ...col.text<T>("code", "Code", (r) => r.code, (r) => (r.code ? <span className="mono">{r.code}</span> : "—")), nowrap: true },
  { ...col.text<T>("name", "Item", (r) => r.name), wide: true },
  col.text<T>("unit", "Unit", (r) => r.unit),
];

// ---- Stock movement for a period ----

export function StockMovementReport() {
  const f = useUrlFilters({ from: monthStart, to: (t) => t, storeId: "", itemGroupId: "" });
  const v = f.values;
  const stores = useReportStores();
  const groups = useItemGroupOptions();
  const access = useAllowed(STOCK);
  const r = useReport<StockMovementDto>(`/reports/stock-movement${query({ from: v.from, to: v.to, storeId: v.storeId, itemGroupId: v.itemGroupId })}`, f.ready && access.allowed);
  const columns = (d: StockMovementDto): ReportColumn<StockMovementRow>[] => {
    const t = d.totals;
    const values = t.openingValue !== undefined;
    return [
      ...itemColumns<StockMovementRow>(),
      col.qty<StockMovementRow>("openingQ", "Opening quantity", (x) => x.openingQuantity),
      col.qty<StockMovementRow>("inQ", "In", (x) => x.inQuantity),
      col.qty<StockMovementRow>("outQ", "Out", (x) => x.outQuantity),
      col.qty<StockMovementRow>("closingQ", "Closing quantity", (x) => x.closingQuantity),
      ...(values
        ? [
            col.money<StockMovementRow>("openingV", "Opening value", (x) => x.openingValue, t.openingValue),
            col.money<StockMovementRow>("inV", "Value in", (x) => x.inValue, t.inValue),
            col.money<StockMovementRow>("outV", "Value out", (x) => x.outValue, t.outValue),
            col.money<StockMovementRow>("closingV", "Closing value", (x) => x.closingValue, t.closingValue),
          ]
        : []),
    ];
  };
  return (
    <ReportPage
      id="stock-movement"
      area="stock"
      needs={STOCK}
      ready={f.ready}
      state={r}
      note="In counts everything that raised stock (receipts, transfers in, counts that found more); out counts sales, write-offs, transfers out and counts that found less. Values are at cost."
      filters={
        <>
          <DateFilter id="rf-from" label="From" value={v.from} onChange={(x) => f.set({ from: x })} />
          <DateFilter id="rf-to" label="To" value={v.to} onChange={(x) => f.set({ to: x })} />
          <StoreFilter stores={stores} value={v.storeId} onChange={(x) => f.set({ storeId: x })} />
          <OptionFilter id="rf-group" label="Item group" all="All item groups" options={groups} value={v.itemGroupId} onChange={(x) => f.set({ itemGroupId: x })} />
        </>
      }
      summary={`${periodText(v.from, v.to)} · ${storeName(stores, v.storeId)} · ${optionLabel(groups, v.itemGroupId, "All item groups")}`}
      logFilters={{ from: v.from, to: v.to, store: storeName(stores, v.storeId), itemGroup: optionLabel(groups, v.itemGroupId, "All item groups") }}
      csv={(d) => tableCsv(columns(d), d.rows, true)}
      fileName={csvName("stock-movement", v.from, "to", v.to)}
    >
      {(d) => (
        <>
          {d.totals.turnover ? (
            <p>
              Stock turned over <strong>{d.totals.turnover}</strong> times in the period <span className="muted">(cost of what went out ÷ average stock value)</span>.
            </p>
          ) : null}
          <ReportTable columns={columns(d)} rows={d.rows} rowKey={(x) => x.itemId} empty="No stock moved in this period." totalLabel="Total value" />
        </>
      )}
    </ReportPage>
  );
}

// ---- Stock cover and sell-through ----

function DaysLeft({ row }: { row: StockCoverRow }) {
  if (row.daysLeft === null) return <span className="muted">no sales</span>;
  const low = new Decimal(row.daysLeft).lt(7);
  return (
    <>
      {showQuantity(row.daysLeft)} {low ? <Badge kind="warn">Low</Badge> : null}
    </>
  );
}

export function StockCoverReport() {
  const f = useUrlFilters({ to: (t) => t, days: "30", storeId: "", itemGroupId: "" });
  const v = f.values;
  const stores = useReportStores();
  const groups = useItemGroupOptions();
  const access = useAllowed(STOCK);
  const r = useReport<StockCoverDto>(`/reports/stock-cover${query({ to: v.to, days: v.days, storeId: v.storeId, itemGroupId: v.itemGroupId })}`, f.ready && access.allowed);
  const columns = (d: StockCoverDto): ReportColumn<StockCoverRow>[] => [
    { ...col.text<StockCoverRow>("code", "Code", (x) => x.code, (x) => (x.code ? <span className="mono">{x.code}</span> : "—")), nowrap: true, total: { value: "Total" } },
    { ...col.text<StockCoverRow>("name", "Item", (x) => x.name), wide: true, total: { value: `${d.rows.length} item${d.rows.length === 1 ? "" : "s"}` } },
    col.text<StockCoverRow>("unit", "Unit", (x) => x.unit),
    col.qty<StockCoverRow>("onHand", "On hand", (x) => x.onHand),
    col.qty<StockCoverRow>("sold", `Sold in ${d.days} days`, (x) => x.sold),
    col.qty<StockCoverRow>("perDay", "Sold per day", (x) => x.perDay),
    { key: "daysLeft", header: "Days of stock left", align: "right", value: (x) => x.daysLeft ?? "no sales", render: (x) => <DaysLeft row={x} /> },
    col.qty<StockCoverRow>("opening", "Stock at the start", (x) => x.opening),
    col.qty<StockCoverRow>("cameIn", "Came in", (x) => x.cameIn),
    col.percent<StockCoverRow>("sellThrough", "Sell-through %", (x) => x.sellThroughPercent),
  ];
  return (
    <ReportPage
      id="stock-cover"
      area="stock"
      needs={STOCK}
      ready={f.ready}
      state={r}
      note="Days of stock left = stock on hand ÷ average quantity sold per day. Sell-through = quantity sold ÷ (stock at the start + what came in). Items with the fewest days left come first."
      filters={
        <>
          <DateFilter id="rf-to" label="As on" value={v.to} onChange={(x) => f.set({ to: x })} />
          <SelectInput id="rf-days" label="Rate of sale over" value={v.days} onChange={(e) => f.set({ days: e.target.value })}>
            {["7", "14", "30", "60", "90", "180", "365"].map((n) => (
              <option key={n} value={n}>
                the last {n} days
              </option>
            ))}
          </SelectInput>
          <StoreFilter stores={stores} value={v.storeId} onChange={(x) => f.set({ storeId: x })} />
          <OptionFilter id="rf-group" label="Item group" all="All item groups" options={groups} value={v.itemGroupId} onChange={(x) => f.set({ itemGroupId: x })} />
        </>
      }
      summary={`As on ${formatDate(v.to)} · rate of sale over the last ${v.days} days · ${storeName(stores, v.storeId)} · ${optionLabel(groups, v.itemGroupId, "All item groups")}`}
      logFilters={{ asOn: v.to, days: Number(v.days), store: storeName(stores, v.storeId), itemGroup: optionLabel(groups, v.itemGroupId, "All item groups") }}
      csv={(d) => tableCsv(columns(d), d.rows, true)}
      fileName={csvName("stock-cover", v.to, `${v.days}-days`)}
    >
      {(d) => <ReportTable columns={columns(d)} rows={d.rows} rowKey={(x) => x.itemId} empty="No stock and no sales for these filters." />}
    </ReportPage>
  );
}

// ---- Stock age ----

type AgeRow = StockAgeDto["rows"][number];

export function StockAgeReport() {
  const f = useUrlFilters({ asOf: (t) => t, storeId: "", itemGroupId: "" });
  const v = f.values;
  const stores = useReportStores();
  const groups = useItemGroupOptions();
  const access = useAllowed(STOCK);
  const r = useReport<StockAgeDto>(`/reports/stock-age${query({ asOf: v.asOf, storeId: v.storeId, itemGroupId: v.itemGroupId })}`, f.ready && access.allowed);
  const withValue = (d: StockAgeDto) => d.labels.some((l) => d.totals[l]?.value !== undefined);
  // The API sends totals per age band; the value of all stock is their sum.
  const totalValue = (d: StockAgeDto) => d.labels.reduce((s, l) => s.add(new Decimal(d.totals[l]?.value ?? "0")), new Decimal(0)).toFixed(2);
  const band = (l: string) => `${l} days`;
  const screenColumns = (d: StockAgeDto): ReportColumn<AgeRow>[] => [
    ...itemColumns<AgeRow>(),
    col.qty<AgeRow>("onHand", "On hand", (x) => x.onHand),
    ...(withValue(d) ? [col.money<AgeRow>("value", "Value", (x) => x.value, totalValue(d))] : []),
    ...d.labels.map(
      (l): ReportColumn<AgeRow> => ({
        key: `band-${l}`,
        header: band(l),
        align: "right",
        value: (x) => x.bands[l]?.quantity ?? "0",
        render: (x) => (
          <>
            <Qty value={x.bands[l]?.quantity} />
            {x.bands[l]?.value !== undefined ? (
              <div className="muted">
                <Amount value={x.bands[l]?.value} />
              </div>
            ) : null}
          </>
        ),
        total: d.totals[l]?.value !== undefined ? { value: d.totals[l].value, show: <Amount value={d.totals[l].value} /> } : undefined,
      }),
    ),
  ];
  // The CSV keeps quantity and value in separate columns.
  const csvColumns = (d: StockAgeDto): ReportColumn<AgeRow>[] => [
    ...itemColumns<AgeRow>(),
    col.qty<AgeRow>("onHand", "On hand", (x) => x.onHand),
    ...(withValue(d) ? [col.money<AgeRow>("value", "Value", (x) => x.value, totalValue(d))] : []),
    ...d.labels.flatMap((l) => [
      col.qty<AgeRow>(`q-${l}`, `${band(l)} quantity`, (x) => x.bands[l]?.quantity),
      ...(withValue(d) ? [col.money<AgeRow>(`v-${l}`, `${band(l)} value`, (x) => x.bands[l]?.value, d.totals[l]?.value)] : []),
    ]),
  ];
  return (
    <ReportPage
      id="stock-age"
      area="stock"
      needs={STOCK}
      ready={f.ready}
      state={r}
      note="Assumes the oldest stock is sold first: the stock on hand is matched against the most recent goods that came in, and its age is counted from those dates."
      filters={
        <>
          <DateFilter id="rf-asof" label="As on" value={v.asOf} onChange={(x) => f.set({ asOf: x })} />
          <StoreFilter stores={stores} value={v.storeId} onChange={(x) => f.set({ storeId: x })} />
          <OptionFilter id="rf-group" label="Item group" all="All item groups" options={groups} value={v.itemGroupId} onChange={(x) => f.set({ itemGroupId: x })} />
        </>
      }
      summary={`As on ${formatDate(v.asOf)} · ${storeName(stores, v.storeId)} · ${optionLabel(groups, v.itemGroupId, "All item groups")}`}
      logFilters={{ asOn: v.asOf, store: storeName(stores, v.storeId), itemGroup: optionLabel(groups, v.itemGroupId, "All item groups") }}
      csv={(d) => tableCsv(csvColumns(d), d.rows, true)}
      fileName={csvName("stock-age", v.asOf)}
    >
      {(d) => <ReportTable columns={screenColumns(d)} rows={d.rows} rowKey={(x) => x.itemId} empty="No stock on hand on this date." totalLabel="Total value" />}
    </ReportPage>
  );
}

// ---- Stock variance and loss (shrinkage) ----

type LossRow = ShrinkageDto["rows"][number];

export function ShrinkageReport() {
  const f = useUrlFilters({ from: (t) => addDays(t, -29), to: (t) => t, storeId: "" });
  const v = f.values;
  const stores = useReportStores();
  const access = useAllowed(COST);
  const r = useReport<ShrinkageDto>(`/reports/shrinkage${query({ from: v.from, to: v.to, storeId: v.storeId })}`, f.ready && access.allowed);
  const columns = (d: ShrinkageDto): ReportColumn<LossRow>[] => [
    col.date<LossRow>("date", "Date", (x) => x.date),
    col.text<LossRow>("document", "Document", (x) => x.number, (x) => (
      <Link href={`/stock/documents/${x.documentId}`} className="mono">
        {x.number}
      </Link>
    )),
    col.text<LossRow>("reason", "Reason", (x) => x.reason),
    { ...col.text<LossRow>("item", "Item", (x) => x.item), wide: true },
    col.qty<LossRow>("quantity", "Quantity lost", (x) => x.quantity),
    col.money<LossRow>("value", "Value lost (at cost)", (x) => x.value, d.totals.loss),
  ];
  type ReasonRow = ShrinkageDto["byReason"][number];
  const reasonColumns = (d: ShrinkageDto): ReportColumn<ReasonRow>[] => [
    col.text<ReasonRow>("reason", "Reason", (x) => x.reason),
    col.qty<ReasonRow>("quantity", "Quantity lost", (x) => x.quantity),
    col.money<ReasonRow>("value", "Value lost (at cost)", (x) => x.value, d.totals.loss),
  ];
  return (
    <ReportPage
      id="shrinkage"
      area="stock"
      needs={COST}
      ready={f.ready}
      state={r}
      note="Loss = stock written off as damaged, expired or lost, plus stock counts that found less than expected. Shrinkage % = loss ÷ net sales (before GST) × 100."
      filters={
        <>
          <DateFilter id="rf-from" label="From" value={v.from} onChange={(x) => f.set({ from: x })} />
          <DateFilter id="rf-to" label="To" value={v.to} onChange={(x) => f.set({ to: x })} />
          <StoreFilter stores={stores} value={v.storeId} onChange={(x) => f.set({ storeId: x })} />
        </>
      }
      summary={`${periodText(v.from, v.to)} · ${storeName(stores, v.storeId)}`}
      logFilters={{ from: v.from, to: v.to, store: storeName(stores, v.storeId) }}
      csv={(d) => tableCsv(columns(d), d.rows, true)}
      fileName={csvName("stock-variance-and-loss", v.from, "to", v.to)}
    >
      {(d) => (
        <>
          <dl className="kv report-sums">
            <dt>Stock lost</dt>
            <dd>
              <Amount value={d.totals.loss} />
            </dd>
            <dt>Net sales (before GST)</dt>
            <dd>
              <Amount value={d.totals.netSales} />
            </dd>
            <dt>Shrinkage</dt>
            <dd>{d.totals.shrinkagePercent === null ? <span className="muted">— (no sales in the period)</span> : <strong>{percentText(d.totals.shrinkagePercent)} of net sales</strong>}</dd>
          </dl>
          <h2>By reason</h2>
          <ReportTable columns={reasonColumns(d)} rows={d.byReason} rowKey={(x) => x.reason} empty="No losses." />
          <h2>Each loss</h2>
          <ReportTable columns={columns(d)} rows={d.rows} rowKey={(x, i) => `${x.documentId}-${i}`} empty="No stock was written off or found short in this period." />
        </>
      )}
    </ReportPage>
  );
}
