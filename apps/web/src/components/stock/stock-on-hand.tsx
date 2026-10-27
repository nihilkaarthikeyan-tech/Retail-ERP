// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { rupees } from "@/lib/purchasing";
import { useState } from "react";
import { hasPermission } from "shared";
import { Alert, CheckInput, DataTable, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { flattenGroups } from "@/lib/catalogue";
import { isNegative, LOCATION_KIND_LABELS, showQuantity, storesFromLocations } from "@/lib/stock";
import type { ItemGroupNode, StockBalanceResult, StockBalanceRow } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { StockLookup } from "./stock-lookup";
import { useStockLocations } from "./use-stock-refs";

interface Filters {
  storeId: string;
  locationId: string;
  groupId: string;
  asOf: string;
  includeZero: boolean;
}

/** The stock balance table; cost and value columns only when the API sent them. */
export function StockBalanceTable({ result, loading }: { result: StockBalanceResult | null; loading: boolean }) {
  const rows = result?.rows ?? null;
  const withCost = (rows ?? []).some((r) => r.value !== undefined || r.unitCost !== undefined);
  const columns: Column<StockBalanceRow>[] = [
    { key: "code", header: "Item code", render: (r) => <span className="mono">{r.item.code}</span> },
    { key: "name", header: "Item", render: (r) => r.item.name },
    { key: "store", header: "Store", render: (r) => r.location.store?.code ?? <span className="muted">company</span> },
    {
      key: "location",
      header: "Location",
      render: (r) => (
        <>
          {r.location.name}
          {r.location.kind !== "shelf" ? <span className="muted"> ({LOCATION_KIND_LABELS[r.location.kind] ?? r.location.kind})</span> : null}
        </>
      ),
    },
    {
      key: "qty",
      header: "Quantity",
      align: "right",
      render: (r) => (
        <span className={isNegative(r.quantity) ? "num-negative" : undefined}>
          {showQuantity(r.quantity)} <span className="muted">{r.item.unit}</span>
        </span>
      ),
    },
    ...(withCost
      ? [
          { key: "cost", header: "Cost per unit", align: "right", render: (r: StockBalanceRow) => rupees(r.unitCost) },
          { key: "value", header: "Value", align: "right", render: (r: StockBalanceRow) => rupees(r.value) },
        ] satisfies Column<StockBalanceRow>[]
      : []),
  ];
  return (
    <>
      <DataTable columns={columns} rows={rows} rowKey={(r) => `${r.item.id}-${r.location.id}`} loading={loading} empty="No stock matches." />
      {result?.totals.value !== undefined ? (
        <p>
          <strong>Total value: {rupees(result.totals.value)}</strong>
        </p>
      ) : null}
    </>
  );
}

/** Stock on hand per item and location, with a quick scan lookup at the top. */
export function StockOnHand() {
  const { user } = useAuth();
  const canSeeGroups = hasPermission(user, "catalogue.view");
  const locations = useStockLocations();
  const groups = useLoad<ItemGroupNode[] | null>(() => (canSeeGroups ? api.get<ItemGroupNode[]>("/catalogue/item-groups") : Promise.resolve(null)), [canSeeGroups]);
  const [filters, setFilters] = useState<Filters>({ storeId: "", locationId: "", groupId: "", asOf: "", includeZero: false });
  const balance = useLoad(
    () =>
      api.get<StockBalanceResult>(
        `/stock/balance${query({
          storeId: filters.storeId,
          locationId: filters.locationId,
          groupId: filters.groupId,
          asOf: filters.asOf,
          includeZero: filters.includeZero ? "true" : undefined,
        })}`,
      ),
    [filters.storeId, filters.locationId, filters.groupId, filters.asOf, filters.includeZero],
  );

  const stores = storesFromLocations(locations.data ?? []);
  const locationOptions = (locations.data ?? []).filter((l) => l.kind !== "folder" && (!filters.storeId || l.store?.id === filters.storeId));

  return (
    <>
      <h1>Stock on hand</h1>
      <StockLookup />
      <div className="filter-row">
        <SelectInput id="soh-store" label="Store" value={filters.storeId} onChange={(e) => setFilters({ ...filters, storeId: e.target.value, locationId: "" })}>
          <option value="">All my stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="soh-location" label="Location" value={filters.locationId} onChange={(e) => setFilters({ ...filters, locationId: e.target.value })}>
          <option value="">All locations</option>
          {locationOptions.map((l) => (
            <option key={l.id} value={l.id}>
              {l.store ? `${l.store.code} · ` : ""}
              {l.name}
            </option>
          ))}
        </SelectInput>
        {groups.data ? (
          <SelectInput id="soh-group" label="Item group" value={filters.groupId} onChange={(e) => setFilters({ ...filters, groupId: e.target.value })}>
            <option value="">All groups</option>
            {flattenGroups(groups.data).map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </SelectInput>
        ) : null}
        <TextInput id="soh-asof" label="As of (end of day)" type="date" value={filters.asOf} onChange={(e) => setFilters({ ...filters, asOf: e.target.value })} hint="Blank: right now." />
      </div>
      <CheckInput id="soh-zero" label="Include items with zero stock" checked={filters.includeZero} onChange={(e) => setFilters({ ...filters, includeZero: e.target.checked })} />
      <Alert kind="error">{balance.error ?? locations.error ?? groups.error}</Alert>
      <StockBalanceTable result={balance.data} loading={balance.loading} />
    </>
  );
}
