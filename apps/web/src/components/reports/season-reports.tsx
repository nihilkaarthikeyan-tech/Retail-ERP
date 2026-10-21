// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 11 C4 (owner decision of 16 October 2026): season sell-through. Per
// season, or per style, group or item of one season: bought (goods receipts,
// less returns to the supplier), sold at the tills net of returns, in stock
// now, and the share sold of what the shop has had (sold ÷ (sold + in stock)).
"use client";

import { type PermissionKey } from "shared";
import { SelectInput } from "@/components/ui";
import { api, query } from "@/lib/api";
import { useModules } from "@/lib/modules";
import type { SeasonDto, SellThroughDto, SellThroughRow } from "@/lib/styles-seasons";
import { useLoad } from "@/lib/use-load";
import { col, csvName, OptionFilter, optionLabel, ReportPage, type ReportColumn, ReportTable, StoreFilter, storeName, tableCsv, useAllowed, useReport, useReportStores, useUrlFilters } from "./report-kit";

const SALES: PermissionKey[] = ["pos.reports"];
const BY_LABELS = { season: "Season", style: "Style", group: "Item group", item: "Item" } as const;
type By = keyof typeof BY_LABELS;

export function SeasonSellThroughReport() {
  const f = useUrlFilters({ seasonId: "", storeId: "", groupBy: "" });
  const v = f.values;
  const stores = useReportStores();
  const access = useAllowed(SALES);
  const seasons = useLoad<SeasonDto[]>(() => api.get<SeasonDto[]>("/seasons").catch(() => []));
  const seasonOptions = (seasons.data ?? []).map((s) => ({ id: s.id, label: s.name }));
  // Plan 12: "by style" only while "Sizes and colours" is on.
  const withinSeason: By[] = useModules().isOn("variants") ? ["style", "group", "item"] : ["group", "item"];
  // Without a season the report is per season; with one, per style unless chosen otherwise.
  const by: By = v.seasonId ? (withinSeason.includes(v.groupBy as By) ? (v.groupBy as By) : withinSeason[0]) : "season";
  const r = useReport<SellThroughDto>(`/reports/season-sell-through${query({ seasonId: v.seasonId, storeId: v.storeId, groupBy: by })}`, f.ready && access.allowed);
  const columns = (d: SellThroughDto): ReportColumn<SellThroughRow>[] => [
    { ...col.text<SellThroughRow>("code", "Code", (x) => x.code, (x) => (x.code ? <span className="mono">{x.code}</span> : "—")), nowrap: true },
    { ...col.text<SellThroughRow>("name", BY_LABELS[d.groupBy], (x) => x.name), wide: true },
    col.qty<SellThroughRow>("bought", "Bought", (x) => x.bought, d.totals.bought),
    col.qty<SellThroughRow>("sold", "Sold", (x) => x.sold, d.totals.sold),
    col.qty<SellThroughRow>("inStock", "In stock now", (x) => x.inStock, d.totals.inStock),
    col.percent<SellThroughRow>("percentSold", "Sold %", (x) => x.percentSold, d.totals.percentSold),
  ];
  const season = optionLabel(seasonOptions, v.seasonId, "Every season");
  return (
    <ReportPage
      id="season-sell-through"
      area="sales"
      needs={SALES}
      ready={f.ready}
      state={r}
      note="Quantities are in basic units. Bought counts goods receipts (and bills that receive goods), less returns to the supplier. Sold % is what sold out of what the shop has had: sold ÷ (sold + still in stock)."
      filters={
        <>
          <OptionFilter id="rf-season" label="Season" all="Every season" options={seasonOptions} value={v.seasonId} onChange={(x) => f.set({ seasonId: x, groupBy: "" })} />
          {v.seasonId ? (
            <SelectInput id="rf-group-by" label="Show by" value={by} onChange={(e) => f.set({ groupBy: e.target.value })}>
              {withinSeason.map((o) => (
                <option key={o} value={o}>
                  {BY_LABELS[o]}
                </option>
              ))}
            </SelectInput>
          ) : null}
          <StoreFilter stores={stores} value={v.storeId} onChange={(x) => f.set({ storeId: x })} />
        </>
      }
      summary={`${season} · by ${BY_LABELS[by].toLowerCase()} · ${storeName(stores, v.storeId)}`}
      logFilters={{ season, showBy: BY_LABELS[by], store: storeName(stores, v.storeId) }}
      csv={(d) => tableCsv(columns(d), d.rows, true)}
      fileName={csvName("season-sell-through")}
    >
      {(d) => <ReportTable columns={columns(d)} rows={d.rows} rowKey={(x) => x.key} empty="No items carry a season yet." />}
    </ReportPage>
  );
}
