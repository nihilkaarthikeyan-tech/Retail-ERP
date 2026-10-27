// Copyright (c) 2026, Rademics. All rights reserved.
// Sales reports (plan 09 §1.2): daily sales by store, item-wise sales, best and
// worst sellers, sales by group or brand, returns and cancelled bills,
// discounts given, and gross profit. Sales come from the till bills; net sales
// are before GST. Cost and margin columns appear only when the API sends them.
"use client";

import Link from "next/link";
import { addDays, Decimal, hasPermission, type PermissionKey } from "shared";
import { SelectInput } from "@/components/ui";
import { api, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { useModules } from "@/lib/modules";
import type { SeasonDto } from "@/lib/styles-seasons";
import type { AttributeDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import type {
  DailySalesDto,
  DailySalesRow,
  DiscountRow,
  DiscountsDto,
  GroupBy,
  GroupedRow,
  GroupedSalesDto,
  ReturnsDto,
  ReturnsRow,
  SalesByGroupDto,
  SalesTotals,
} from "@/lib/reports";
import {
  Amount,
  col,
  csvName,
  DateFilter,
  OptionFilter,
  optionLabel,
  periodText,
  ReportPage,
  type ReportColumn,
  ReportTable,
  StoreFilter,
  storeName,
  tableCsv,
  useAllowed,
  useBrandOptions,
  useItemGroupOptions,
  useReport,
  useReportStores,
  useUrlFilters,
} from "./report-kit";

const SALES: PermissionKey[] = ["pos.reports"];
const COST: PermissionKey[] = ["cost_price.view", "stock.cost.view"];
const monthStart = (today: string) => `${today.slice(0, 7)}-01`;
const NET_NOTE = "Net sales are before GST (taxable value). Returns count on the day they happen; cancelled bills are left out.";

const GROUP_LABELS: Record<GroupBy, string> = { item: "Item", group: "Item group", brand: "Brand", customer: "Customer", store: "Store", cashier: "Cashier", style: "Style", season: "Season", attribute: "Size or colour" };

/** The sales figures every grouped sales report shares; cost columns only when the API sent them. */
function salesFigures<T extends SalesTotals>(totals: SalesTotals, opts: { bills?: boolean; returns?: boolean } = {}): ReportColumn<T>[] {
  const seesCost = totals.cost !== undefined;
  return [
    ...(opts.bills !== false ? [col.count<T>("bills", "Sale bills", (r) => r.saleBills, totals.saleBills)] : []),
    col.qty<T>("quantity", "Pieces sold (before returns)", (r) => r.quantity, totals.quantity),
    ...(opts.returns !== false
      ? [col.money<T>("gross", "Sales (before GST)", (r) => r.grossSales, totals.grossSales), col.money<T>("returns", "Returns (before GST)", (r) => r.returns, totals.returns)]
      : []),
    col.money<T>("net", "Net sales (before GST)", (r) => r.netSales, totals.netSales),
    col.money<T>("tax", "GST", (r) => r.tax, totals.tax),
    col.money<T>("discounts", "Discounts (incl. GST, as charged)", (r) => r.discounts, totals.discounts),
    ...(seesCost
      ? [
          col.money<T>("cost", "Cost of goods sold", (r) => r.cost, totals.cost),
          col.money<T>("profit", "Gross profit", (r) => r.grossProfit, totals.grossProfit),
          col.percent<T>("margin", "Margin %", (r) => r.marginPercent, totals.marginPercent ?? null),
        ]
      : []),
  ];
}

function nameColumns(by: GroupBy, label?: string): ReportColumn<GroupedRow>[] {
  return [{ ...col.text<GroupedRow>("code", "Code", (r) => r.code, (r) => (r.code ? <span className="mono">{r.code}</span> : "—")), nowrap: true }, { ...col.text<GroupedRow>("name", label ?? GROUP_LABELS[by], (r) => r.name), wide: true }];
}

function GroupBySelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: GroupBy[] }) {
  return (
    <SelectInput id="rf-group-by" label="Show by" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {GROUP_LABELS[o]}
        </option>
      ))}
    </SelectInput>
  );
}

// ---- Daily sales by store ----

export function DailySalesReport() {
  const f = useUrlFilters({ from: (t) => addDays(t, -6), to: (t) => t, storeId: "" });
  const v = f.values;
  const stores = useReportStores();
  const access = useAllowed(SALES);
  const r = useReport<DailySalesDto>(`/reports/daily-sales${query({ from: v.from, to: v.to, storeId: v.storeId })}`, f.ready && access.allowed);
  const columns = (d: DailySalesDto): ReportColumn<DailySalesRow>[] => [
    col.date<DailySalesRow>("date", "Date", (x) => x.date),
    col.text<DailySalesRow>("store", "Store", (x) => x.store),
    col.count<DailySalesRow>("bills", "Sale bills", (x) => x.saleBills, d.totals.saleBills),
    col.count<DailySalesRow>("returnBills", "Return bills", (x) => x.returnBills, d.totals.returnBills),
    ...salesFigures<DailySalesRow>(d.totals, { bills: false }),
    col.money<DailySalesRow>("average", "Average bill", (x) => x.averageBill, d.totals.averageBill),
  ];
  return (
    <ReportPage
      id="daily-sales"
      area="sales"
      needs={SALES}
      ready={f.ready}
      state={r}
      note={NET_NOTE}
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
      fileName={csvName("daily-sales", v.from, "to", v.to)}
    >
      {(d) => <ReportTable columns={columns(d)} rows={d.rows} rowKey={(x) => `${x.date}-${x.storeId}`} empty="No sales in this period." />}
    </ReportPage>
  );
}

// ---- Item-wise sales ----

export function ItemSalesReport() {
  const f = useUrlFilters({ from: monthStart, to: (t) => t, storeId: "", groupBy: "item", attributeId: "", itemGroupId: "", brandId: "", seasonId: "" });
  const v = f.values;
  const { user } = useAuth();
  const canSeeCatalogue = hasPermission(user, "catalogue.view");
  // Plan 12: style, size and colour only with "Sizes and colours" on; seasons only with "Seasons and markdowns" on.
  const { isOn } = useModules();
  const variantsOn = isOn("variants");
  const seasonsOn = isOn("seasons");
  // Plan 11 C3, C4: by style, by each size or colour attribute, by season, and only one season.
  const attributes = useLoad<AttributeDto[]>(() => (canSeeCatalogue && variantsOn ? api.get<AttributeDto[]>("/catalogue/attributes").catch(() => []) : Promise.resolve([])), [canSeeCatalogue, variantsOn]);
  const seasons = useLoad<SeasonDto[]>(() => (canSeeCatalogue && seasonsOn ? api.get<SeasonDto[]>("/seasons").catch(() => []) : Promise.resolve([])), [canSeeCatalogue, seasonsOn]);
  const attribute = (attributes.data ?? []).find((a) => a.id === v.attributeId) ?? null;
  const allowedBy = (g: string) => ((g === "style" || g === "attribute") && !variantsOn) || (g === "season" && !seasonsOn) ? false : g in GROUP_LABELS;
  const by = (allowedBy(v.groupBy) && (v.groupBy !== "attribute" || v.attributeId) ? v.groupBy : "item") as GroupBy;
  const seasonId = seasonsOn ? v.seasonId : "";
  const byLabel = by === "attribute" ? (attribute?.name ?? GROUP_LABELS.attribute) : GROUP_LABELS[by];
  const stores = useReportStores();
  const groups = useItemGroupOptions();
  const brands = useBrandOptions();
  const seasonOptions = (seasons.data ?? []).map((s) => ({ id: s.id, label: s.name }));
  const access = useAllowed(SALES);
  const r = useReport<GroupedSalesDto>(
    `/reports/item-sales${query({ from: v.from, to: v.to, storeId: v.storeId, groupBy: by, attributeId: by === "attribute" ? v.attributeId : "", itemGroupId: v.itemGroupId, brandId: v.brandId, seasonId })}`,
    f.ready && access.allowed,
  );
  const columns = (d: GroupedSalesDto): ReportColumn<GroupedRow>[] => [...nameColumns(d.groupBy, byLabel), ...salesFigures<GroupedRow>(d.totals)];
  const group = optionLabel(groups, v.itemGroupId, "All item groups");
  const brand = optionLabel(brands, v.brandId, "All brands");
  const season = optionLabel(seasonOptions, seasonId, "All seasons");
  const showByValue = by === "attribute" ? `attribute:${v.attributeId}` : by;
  return (
    <ReportPage
      id="item-sales"
      area="sales"
      needs={SALES}
      ready={f.ready}
      state={r}
      note={NET_NOTE}
      filters={
        <>
          <DateFilter id="rf-from" label="From" value={v.from} onChange={(x) => f.set({ from: x })} />
          <DateFilter id="rf-to" label="To" value={v.to} onChange={(x) => f.set({ to: x })} />
          <SelectInput
            id="rf-group-by"
            label="Show by"
            value={showByValue}
            onChange={(e) => {
              const x = e.target.value;
              f.set(x.startsWith("attribute:") ? { groupBy: "attribute", attributeId: x.slice("attribute:".length) } : { groupBy: x, attributeId: "" });
            }}
          >
            {((variantsOn ? ["item", "style"] : ["item"]) as GroupBy[]).map((o) => (
              <option key={o} value={o}>
                {GROUP_LABELS[o]}
              </option>
            ))}
            {(attributes.data ?? []).map((a) => (
              <option key={a.id} value={`attribute:${a.id}`}>
                {a.name}
              </option>
            ))}
            {((seasonsOn ? ["season", "group", "brand", "customer", "store", "cashier"] : ["group", "brand", "customer", "store", "cashier"]) as GroupBy[]).map((o) => (
              <option key={o} value={o}>
                {GROUP_LABELS[o]}
              </option>
            ))}
          </SelectInput>
          <StoreFilter stores={stores} value={v.storeId} onChange={(x) => f.set({ storeId: x })} />
          <OptionFilter id="rf-group" label="Item group" all="All item groups" options={groups} value={v.itemGroupId} onChange={(x) => f.set({ itemGroupId: x })} />
          <OptionFilter id="rf-brand" label="Brand" all="All brands" options={brands} value={v.brandId} onChange={(x) => f.set({ brandId: x })} />
          {seasonsOn ? <OptionFilter id="rf-season" label="Season" all="All seasons" options={seasonOptions} value={v.seasonId} onChange={(x) => f.set({ seasonId: x })} /> : null}
        </>
      }
      summary={`${periodText(v.from, v.to)} · by ${byLabel.toLowerCase()} · ${storeName(stores, v.storeId)} · ${group} · ${brand}${seasonsOn ? ` · ${season}` : ""}`}
      logFilters={{ from: v.from, to: v.to, showBy: byLabel, store: storeName(stores, v.storeId), itemGroup: group, brand, ...(seasonsOn ? { season } : {}) }}
      csv={(d) => tableCsv(columns(d), d.rows, true)}
      fileName={csvName("item-sales", v.from, "to", v.to)}
    >
      {(d) => <ReportTable columns={columns(d)} rows={d.rows} rowKey={(x) => x.key} empty="Nothing sold in this period." />}
    </ReportPage>
  );
}

// ---- Best and worst sellers ----

export function BestSellersReport() {
  const { user } = useAuth();
  const seesCost = COST.some((k) => hasPermission(user, k));
  const f = useUrlFilters({ from: (t) => addDays(t, -29), to: (t) => t, storeId: "", rankBy: "sales", worst: "", limit: "20", itemGroupId: "", brandId: "" });
  const v = f.values;
  const stores = useReportStores();
  const groups = useItemGroupOptions();
  const brands = useBrandOptions();
  const access = useAllowed(SALES);
  const worst = v.worst === "true";
  const r = useReport<GroupedSalesDto>(
    `/reports/best-sellers${query({ from: v.from, to: v.to, storeId: v.storeId, rankBy: v.rankBy, worst: worst ? "true" : undefined, limit: v.limit, itemGroupId: v.itemGroupId, brandId: v.brandId })}`,
    f.ready && access.allowed,
  );
  const columns = (d: GroupedSalesDto): ReportColumn<GroupedRow>[] => {
    const cost = d.totals.cost !== undefined;
    return [
      col.count<GroupedRow>("rank", "Rank", (x) => x.rank ?? 0),
      ...nameColumns("item"),
      col.qty<GroupedRow>("quantity", "Pieces sold (before returns)", (x) => x.quantity, d.totals.quantity),
      col.money<GroupedRow>("net", "Net sales (before GST)", (x) => x.netSales, d.totals.netSales),
      ...(cost ? [col.money<GroupedRow>("profit", "Gross profit", (x) => x.grossProfit, d.totals.grossProfit), col.percent<GroupedRow>("margin", "Margin %", (x) => x.marginPercent, d.totals.marginPercent ?? null)] : []),
    ];
  };
  const rankLabel = v.rankBy === "quantity" ? "quantity sold" : v.rankBy === "margin" ? "gross profit" : "net sales";
  return (
    <ReportPage
      id="best-sellers"
      area="sales"
      needs={SALES}
      ready={f.ready}
      state={r}
      note={`Items ranked by ${rankLabel}. The totals row covers every item sold in the period, not only those listed. ${NET_NOTE}`}
      filters={
        <>
          <DateFilter id="rf-from" label="From" value={v.from} onChange={(x) => f.set({ from: x })} />
          <DateFilter id="rf-to" label="To" value={v.to} onChange={(x) => f.set({ to: x })} />
          <SelectInput id="rf-rank" label="Rank by" value={v.rankBy} onChange={(e) => f.set({ rankBy: e.target.value })}>
            <option value="sales">Net sales</option>
            <option value="quantity">Quantity sold</option>
            {seesCost ? <option value="margin">Gross profit</option> : null}
          </SelectInput>
          <SelectInput id="rf-worst" label="Show" value={worst ? "true" : ""} onChange={(e) => f.set({ worst: e.target.value })}>
            <option value="">Best sellers</option>
            <option value="true">Worst sellers</option>
          </SelectInput>
          <SelectInput id="rf-limit" label="How many" value={v.limit} onChange={(e) => f.set({ limit: e.target.value })}>
            {["10", "20", "50", "100"].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectInput>
          <StoreFilter stores={stores} value={v.storeId} onChange={(x) => f.set({ storeId: x })} />
          <OptionFilter id="rf-group" label="Item group" all="All item groups" options={groups} value={v.itemGroupId} onChange={(x) => f.set({ itemGroupId: x })} />
          <OptionFilter id="rf-brand" label="Brand" all="All brands" options={brands} value={v.brandId} onChange={(x) => f.set({ brandId: x })} />
        </>
      }
      summary={`${periodText(v.from, v.to)} · ${worst ? "worst" : "best"} ${v.limit} by ${rankLabel} · ${storeName(stores, v.storeId)}`}
      logFilters={{ from: v.from, to: v.to, rankBy: rankLabel, show: worst ? "Worst sellers" : "Best sellers", howMany: Number(v.limit), store: storeName(stores, v.storeId), itemGroup: optionLabel(groups, v.itemGroupId, "All item groups"), brand: optionLabel(brands, v.brandId, "All brands") }}
      csv={(d) => tableCsv(columns(d), d.rows, true)}
      fileName={csvName(worst ? "worst-sellers" : "best-sellers", v.from, "to", v.to)}
    >
      {(d) => <ReportTable columns={columns(d)} rows={d.rows} rowKey={(x) => x.key} empty="Nothing sold in this period." totalLabel="All items in the period" />}
    </ReportPage>
  );
}

// ---- Sales by group or brand, week by week ----

type GroupWeekRow = SalesByGroupDto["rows"][number];

export function SalesByGroupReport() {
  const f = useUrlFilters({ from: (t) => addDays(t, -27), to: (t) => t, storeId: "", groupBy: "group" });
  const v = f.values;
  const by = v.groupBy === "brand" ? "brand" : "group";
  const stores = useReportStores();
  const access = useAllowed(SALES);
  const r = useReport<SalesByGroupDto>(`/reports/sales-by-group${query({ from: v.from, to: v.to, storeId: v.storeId, groupBy: by })}`, f.ready && access.allowed);
  const columns = (d: SalesByGroupDto): ReportColumn<GroupWeekRow>[] => {
    // The API sends no totals row for this report; columns are added up here with Decimal.
    const sum = (get: (x: GroupWeekRow) => string | undefined) => d.rows.reduce((s, x) => s.add(new Decimal(get(x) ?? "0")), new Decimal(0)).toFixed(2);
    return [
      { ...col.text<GroupWeekRow>("name", by === "brand" ? "Brand" : "Item group", (x) => x.name), wide: true },
      ...d.weeks.map((w) => col.money<GroupWeekRow>(`w-${w}`, `Week of ${formatDate(w)}`, (x) => x.weeks[w]?.netSales ?? "0.00", sum((x) => x.weeks[w]?.netSales))),
      col.money<GroupWeekRow>("net", "Net sales (before GST)", (x) => x.netSales, sum((x) => x.netSales)),
      col.qty<GroupWeekRow>("quantity", "Quantity (after returns)", (x) => x.quantity),
    ];
  };
  return (
    <ReportPage
      id="sales-by-group"
      area="sales"
      needs={SALES}
      ready={f.ready}
      state={r}
      note={`Net sales before GST, week by week (weeks start on Monday). ${by === "brand" ? "Items without a brand are under “No brand”." : ""}`}
      filters={
        <>
          <DateFilter id="rf-from" label="From" value={v.from} onChange={(x) => f.set({ from: x })} />
          <DateFilter id="rf-to" label="To" value={v.to} onChange={(x) => f.set({ to: x })} />
          <SelectInput id="rf-group-by" label="Show by" value={by} onChange={(e) => f.set({ groupBy: e.target.value })}>
            <option value="group">Item group</option>
            <option value="brand">Brand</option>
          </SelectInput>
          <StoreFilter stores={stores} value={v.storeId} onChange={(x) => f.set({ storeId: x })} />
        </>
      }
      summary={`${periodText(v.from, v.to)} · by ${by === "brand" ? "brand" : "item group"} · ${storeName(stores, v.storeId)}`}
      logFilters={{ from: v.from, to: v.to, showBy: by === "brand" ? "Brand" : "Item group", store: storeName(stores, v.storeId) }}
      csv={(d) => tableCsv(columns(d), d.rows, true)}
      fileName={csvName("sales-by-group", v.from, "to", v.to)}
    >
      {(d) => <ReportTable columns={columns(d)} rows={d.rows} rowKey={(x) => x.key} empty="Nothing sold in this period." />}
    </ReportPage>
  );
}

// ---- Returns and cancelled bills ----

export function ReturnsReport() {
  const f = useUrlFilters({ from: (t) => addDays(t, -6), to: (t) => t, storeId: "" });
  const v = f.values;
  const stores = useReportStores();
  const access = useAllowed(SALES);
  const r = useReport<ReturnsDto>(`/reports/returns${query({ from: v.from, to: v.to, storeId: v.storeId })}`, f.ready && access.allowed);
  const columns = (d: ReturnsDto): ReportColumn<ReturnsRow>[] => [
    col.date<ReturnsRow>("date", "Date", (x) => x.date),
    col.text<ReturnsRow>("bill", "Bill", (x) => x.number, (x) => (
      <Link href={`/pos/bills/${x.billId}`} className="mono">
        {x.number}
      </Link>
    )),
    col.text<ReturnsRow>("what", "What", (x) => x.what),
    col.text<ReturnsRow>("original", "Original bill", (x) => x.originalBill, (x) => (x.originalBill ? <span className="mono">{x.originalBill}</span> : "—")),
    col.text<ReturnsRow>("store", "Store", (x) => x.store),
    col.text<ReturnsRow>("till", "Till", (x) => x.till),
    { ...col.text<ReturnsRow>("items", "Items", (x) => x.items), wide: true },
    col.text<ReturnsRow>("reason", "Reason", (x) => x.reason),
    col.text<ReturnsRow>("cashier", "Cashier", (x) => x.cashier),
    col.text<ReturnsRow>("approved", "Approved by", (x) => x.approvedBy),
    col.text<ReturnsRow>("cancelled", "Cancelled by", (x) => x.cancelledBy),
    col.money<ReturnsRow>("value", "Value (with GST)", (x) => x.value, d.totals.returns),
  ];
  return (
    <ReportPage
      id="returns"
      area="sales"
      needs={SALES}
      ready={f.ready}
      state={r}
      note="Values include GST, as on the bill. The total counts completed returns only; cancelled bills are listed but not added."
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
      fileName={csvName("returns-and-cancelled-bills", v.from, "to", v.to)}
    >
      {(d) => <ReportTable columns={columns(d)} rows={d.rows} rowKey={(x) => x.billId} empty="No returns or cancelled bills in this period." totalLabel={`Returns (${d.totals.count} bill${d.totals.count === 1 ? "" : "s"} listed)`} />}
    </ReportPage>
  );
}

// ---- Discounts given ----

export function DiscountsReport() {
  const f = useUrlFilters({ from: (t) => addDays(t, -6), to: (t) => t, storeId: "", itemGroupId: "", brandId: "" });
  const v = f.values;
  const stores = useReportStores();
  const groups = useItemGroupOptions();
  const brands = useBrandOptions();
  const access = useAllowed(SALES);
  const r = useReport<DiscountsDto>(`/reports/discounts${query({ from: v.from, to: v.to, storeId: v.storeId, itemGroupId: v.itemGroupId, brandId: v.brandId })}`, f.ready && access.allowed);
  const columns = (d: DiscountsDto): ReportColumn<DiscountRow>[] => [
    col.date<DiscountRow>("date", "Date", (x) => x.date),
    col.text<DiscountRow>("bill", "Bill", (x) => x.number, (x) => (
      <Link href={`/pos/bills/${x.billId}`} className="mono">
        {x.number}
      </Link>
    )),
    { ...col.text<DiscountRow>("item", "Item", (x) => x.item), wide: true },
    col.qty<DiscountRow>("quantity", "Quantity", (x) => x.quantity),
    col.money<DiscountRow>("list", "List price", (x) => x.listPrice),
    col.money<DiscountRow>("price", "Price charged", (x) => x.price),
    col.money<DiscountRow>("priceChange", "Price lowered by", (x) => x.priceChange, d.totals.priceChanges),
    col.percent<DiscountRow>("percent", "Discount %", (x) => x.discountPercent),
    col.money<DiscountRow>("lineAndBill", "Line and bill discount", (x) => x.lineAndBillDiscount, d.totals.lineAndBillDiscounts),
    col.money<DiscountRow>("offerDiscount", "Offer discount", (x) => x.offerDiscount, d.totals.offers),
    col.text<DiscountRow>("offer", "Offer", (x) => x.offer),
    col.text<DiscountRow>("coupon", "Coupon", (x) => x.coupon, (x) => (x.coupon ? <span className="mono">{x.coupon}</span> : "—")),
    col.text<DiscountRow>("cashier", "Cashier", (x) => x.cashier),
    col.text<DiscountRow>("approved", "Approved by", (x) => x.approvedBy),
  ];
  return (
    <ReportPage
      id="discounts"
      area="sales"
      needs={SALES}
      ready={f.ready}
      state={r}
      note="Amounts include GST, as charged at the till. A bill discount is shared over the bill's lines."
      filters={
        <>
          <DateFilter id="rf-from" label="From" value={v.from} onChange={(x) => f.set({ from: x })} />
          <DateFilter id="rf-to" label="To" value={v.to} onChange={(x) => f.set({ to: x })} />
          <StoreFilter stores={stores} value={v.storeId} onChange={(x) => f.set({ storeId: x })} />
          <OptionFilter id="rf-group" label="Item group" all="All item groups" options={groups} value={v.itemGroupId} onChange={(x) => f.set({ itemGroupId: x })} />
          <OptionFilter id="rf-brand" label="Brand" all="All brands" options={brands} value={v.brandId} onChange={(x) => f.set({ brandId: x })} />
        </>
      }
      summary={`${periodText(v.from, v.to)} · ${storeName(stores, v.storeId)}`}
      logFilters={{ from: v.from, to: v.to, store: storeName(stores, v.storeId), itemGroup: optionLabel(groups, v.itemGroupId, "All item groups"), brand: optionLabel(brands, v.brandId, "All brands") }}
      csv={(d) => tableCsv(columns(d), d.rows, true)}
      fileName={csvName("discounts-given", v.from, "to", v.to)}
    >
      {(d) => (
        <>
          <dl className="kv report-sums">
            <dt>All discounts</dt>
            <dd>
              <Amount value={d.totals.all} />
            </dd>
            <dt>Line and bill discounts</dt>
            <dd>
              <Amount value={d.totals.lineAndBillDiscounts} /> <span className="muted">(of which bill discounts <Amount value={d.totals.ofWhichBillDiscounts} />)</span>
            </dd>
            <dt>Offers</dt>
            <dd>
              <Amount value={d.totals.offers} />
            </dd>
            <dt>Prices lowered at the till</dt>
            <dd>
              <Amount value={d.totals.priceChanges} />
            </dd>
          </dl>
          <ReportTable columns={columns(d)} rows={d.rows} rowKey={(x, i) => `${x.billId}-${i}`} empty="No discounts in this period." />
        </>
      )}
    </ReportPage>
  );
}

// ---- Gross profit ----

export function GrossProfitReport() {
  const f = useUrlFilters({ from: monthStart, to: (t) => t, storeId: "", groupBy: "group", itemGroupId: "", brandId: "" });
  const v = f.values;
  const by = (["item", "group", "brand", "customer", "store"].includes(v.groupBy) ? v.groupBy : "group") as GroupBy;
  const stores = useReportStores();
  const groups = useItemGroupOptions();
  const brands = useBrandOptions();
  const access = useAllowed(COST);
  const r = useReport<GroupedSalesDto>(`/reports/gross-profit${query({ from: v.from, to: v.to, storeId: v.storeId, groupBy: by, itemGroupId: v.itemGroupId, brandId: v.brandId })}`, f.ready && access.allowed);
  const columns = (d: GroupedSalesDto): ReportColumn<GroupedRow>[] => {
    const t = d.totals;
    return [
      ...nameColumns(d.groupBy),
      col.qty<GroupedRow>("quantity", "Pieces sold (before returns)", (x) => x.quantity, t.quantity),
      col.money<GroupedRow>("net", "Net sales (before GST)", (x) => x.netSales, t.netSales),
      ...(t.cost !== undefined
        ? [
            col.money<GroupedRow>("cost", "Cost of goods sold", (x) => x.cost, t.cost),
            col.money<GroupedRow>("profit", "Gross profit", (x) => x.grossProfit, t.grossProfit),
            col.percent<GroupedRow>("margin", "Margin %", (x) => x.marginPercent, t.marginPercent ?? null),
          ]
        : []),
    ];
  };
  return (
    <ReportPage
      id="gross-profit"
      area="sales"
      needs={COST}
      ready={f.ready}
      state={r}
      note="Net sales are before GST. Cost is what the goods cost when they were sold, plus any later correction such as freight added afterwards, so it agrees with the accounts."
      filters={
        <>
          <DateFilter id="rf-from" label="From" value={v.from} onChange={(x) => f.set({ from: x })} />
          <DateFilter id="rf-to" label="To" value={v.to} onChange={(x) => f.set({ to: x })} />
          <GroupBySelect value={by} onChange={(x) => f.set({ groupBy: x })} options={["group", "item", "brand", "customer", "store"]} />
          <StoreFilter stores={stores} value={v.storeId} onChange={(x) => f.set({ storeId: x })} />
          <OptionFilter id="rf-group" label="Item group" all="All item groups" options={groups} value={v.itemGroupId} onChange={(x) => f.set({ itemGroupId: x })} />
          <OptionFilter id="rf-brand" label="Brand" all="All brands" options={brands} value={v.brandId} onChange={(x) => f.set({ brandId: x })} />
        </>
      }
      summary={`${periodText(v.from, v.to)} · by ${GROUP_LABELS[by].toLowerCase()} · ${storeName(stores, v.storeId)}`}
      logFilters={{ from: v.from, to: v.to, showBy: GROUP_LABELS[by], store: storeName(stores, v.storeId), itemGroup: optionLabel(groups, v.itemGroupId, "All item groups"), brand: optionLabel(brands, v.brandId, "All brands") }}
      csv={(d) => tableCsv(columns(d), d.rows, true)}
      fileName={csvName("gross-profit", v.from, "to", v.to)}
    >
      {(d) => <ReportTable columns={columns(d)} rows={d.rows} rowKey={(x) => x.key} empty="Nothing sold in this period." />}
    </ReportPage>
  );
}
