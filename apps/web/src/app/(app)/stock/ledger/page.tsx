// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { ItemPicker } from "@/components/prices/item-picker";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert, Badge, DataTable, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { indianTime, isNegative, KIND_LABELS, locationLabel, showQuantity, storesFromLocations } from "@/lib/stock";
import type { ItemDto, StockLedgerRow } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

const LIMIT = 200;

/**
 * Every kind of movement in plain words, and where its document is. Found in the launch check
 * of 27 October 2026: a return showed as "purchase_return", and goods receipts, till bills and
 * freight linked to the stock documents page.
 */
const MOVEMENT_LABELS: Record<string, string> = {
  ...KIND_LABELS,
  goods_receipt: "Goods receipt",
  purchase_return: "Return to supplier",
  landed_charge: "Freight and charges",
  pos_sale: "Till sale",
  pos_return: "Till return",
};

function movementHref(d: { id: string; kind: string }): string {
  if (d.kind === "goods_receipt" || d.kind === "purchase_return") return `/purchases/receipts/${d.id}`;
  if (d.kind === "landed_charge") return `/purchases/charges/${d.id}`;
  if (d.kind === "pos_sale" || d.kind === "pos_return") return `/pos/bills/${d.id}`;
  return `/stock/documents/${d.id}`;
}


export default function StockHistoryPage() {
  const locations = useStockLocations();
  const [item, setItem] = useState<ItemDto | null>(null);
  const [filters, setFilters] = useState({ storeId: "", locationId: "", from: "", to: "" });
  const ledger = useLoad(
    () => api.get<StockLedgerRow[]>(`/stock/ledger${query({ itemId: item?.id, storeId: filters.storeId, locationId: filters.locationId, from: filters.from, to: filters.to, limit: LIMIT })}`),
    [item?.id, filters.storeId, filters.locationId, filters.from, filters.to],
  );
  const stores = storesFromLocations(locations.data ?? []);
  const locationOptions = (locations.data ?? []).filter((l) => l.kind !== "folder" && (!filters.storeId || l.store?.id === filters.storeId));
  const withCost = (ledger.data ?? []).some((r) => r.valueChange !== undefined);

  const columns: Column<StockLedgerRow>[] = [
    {
      key: "when",
      header: "Date",
      render: (r) => (
        <span style={{ whiteSpace: "nowrap" }}>
          {formatDate(r.postingDate)} {indianTime(r.postingAt)}
        </span>
      ),
    },
    {
      key: "doc",
      header: "Document",
      render: (r) =>
        r.document ? (
          <>
            <Link href={movementHref(r.document)} className="mono">
              {r.document.number}
            </Link>
            <span className="muted"> {MOVEMENT_LABELS[r.document.kind] ?? r.document.kind}</span>
          </>
        ) : (
          "—"
        ),
    },
    {
      key: "item",
      header: "Item",
      render: (r) =>
        r.item ? (
          <>
            <span className="mono">{r.item.code}</span> {r.item.name}
          </>
        ) : (
          "—"
        ),
    },
    { key: "location", header: "Location", render: (r) => locationLabel(r.location) },
    {
      key: "change",
      header: "Change",
      align: "right",
      render: (r) => {
        const q = showQuantity(r.quantityChange);
        return <span className={isNegative(r.quantityChange) ? "num-negative" : undefined}>{isNegative(r.quantityChange) ? q : `+${q}`}</span>;
      },
    },
    { key: "after", header: "Quantity after", align: "right", render: (r) => <span className={isNegative(r.quantityAfter) ? "num-negative" : undefined}>{showQuantity(r.quantityAfter)}</span> },
    ...(withCost
      ? [
          { key: "cost", header: "Cost per unit", align: "right", render: (r: StockLedgerRow) => rupees(r.unitCost) },
          { key: "value", header: "Value change", align: "right", render: (r: StockLedgerRow) => rupees(r.valueChange) },
          { key: "costAfter", header: "Cost after", align: "right", render: (r: StockLedgerRow) => rupees(r.unitCostAfter) },
          { key: "valueAfter", header: "Value after", align: "right", render: (r: StockLedgerRow) => rupees(r.valueAfter) },
        ] satisfies Column<StockLedgerRow>[]
      : []),
    {
      key: "flags",
      header: "",
      render: (r) => (
        <>
          {r.isCancellation ? <Badge kind="neutral">Cancellation</Badge> : null} {r.wentNegative ? <Badge kind="off">Went negative</Badge> : null}
        </>
      ),
    },
  ];

  return (
    <>
      <h1>Stock history</h1>
      <p className="muted">Every stock movement, newest first. Current stock is always the sum of these lines.</p>
      <div className="card">
        <ItemPicker id="ledger-item" label="Item (optional)" value={item} onChange={setItem} />
        <div className="filter-row">
          <SelectInput id="ledger-store" label="Store" value={filters.storeId} onChange={(e) => setFilters({ ...filters, storeId: e.target.value, locationId: "" })}>
            <option value="">All my stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput id="ledger-location" label="Location" value={filters.locationId} onChange={(e) => setFilters({ ...filters, locationId: e.target.value })}>
            <option value="">All locations</option>
            {locationOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {locationLabel(l)}
              </option>
            ))}
          </SelectInput>
          <TextInput id="ledger-from" label="From" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          <TextInput id="ledger-to" label="To" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
      </div>
      <Alert kind="error">{ledger.error ?? locations.error}</Alert>
      <DataTable
        columns={columns}
        rows={ledger.data}
        rowKey={(r) => r.id}
        loading={ledger.loading}
        empty="No movements match."
        rowClassName={(r) => (r.wentNegative ? "row-alert" : r.isCancellation ? "row-muted" : undefined)}
      />
      {ledger.data && ledger.data.length >= LIMIT ? <p className="muted">Showing the latest {LIMIT} lines. Narrow the filters to see older ones.</p> : null}
    </>
  );
}
