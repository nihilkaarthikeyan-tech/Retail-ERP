// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { PartyPicker } from "@/components/parties/party-picker";
import { ReceiptStatusBadge } from "@/components/purchasing/receipts-parts";
import { BackDatedBadge } from "@/components/stock/stock-doc-parts";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert, Button, DataTable, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { type GoodsReceiptHeader, type GoodsReceiptStatus, type Page, purchaseRights, RECEIPT_STATUS_LABELS, rupees } from "@/lib/purchasing";
import { showQuantity, storesFromLocations } from "@/lib/stock";
import type { PartyRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

const PAGE_SIZE = 50;

export default function GoodsReceiptsPage() {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const locations = useStockLocations();
  const [filters, setFilters] = useState({ status: "", storeId: "", isReturn: "", isConsignment: "", from: "", to: "" });
  const [supplier, setSupplier] = useState<PartyRef | null>(null);
  const [page, setPage] = useState(1);
  const receipts = useLoad(
    () => api.get<Page<GoodsReceiptHeader>>(`/purchase/receipts${query({ ...filters, supplierId: supplier?.id, page, pageSize: PAGE_SIZE })}`),
    [filters.status, filters.storeId, filters.isReturn, filters.isConsignment, filters.from, filters.to, supplier?.id, page],
  );
  const stores = storesFromLocations(locations.data ?? []);
  const rows = receipts.data?.rows;
  const withTotal = (rows ?? []).some((r) => r.total !== undefined);
  const withValue = (rows ?? []).some((r) => r.stockValue !== undefined);

  function setFilter(key: keyof typeof filters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  const columns: Column<GoodsReceiptHeader>[] = [
    {
      key: "number",
      header: "Number",
      render: (r) => (
        <Link href={`/purchases/receipts/${r.id}`} className="mono">
          {r.number}
        </Link>
      ),
    },
    { key: "date", header: "Date", render: (r) => formatDate(r.postingDate) },
    { key: "supplier", header: "Supplier", render: (r) => r.supplier.name },
    { key: "store", header: "Store", render: (r) => r.store.code },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <>
          <ReceiptStatusBadge receipt={r} /> <BackDatedBadge show={r.isBackDated} />
        </>
      ),
    },
    { key: "billed", header: "Billed", align: "right", render: (r) => (r.isReturn ? "—" : `${showQuantity(r.billedPercent)}%`) },
    ...(withTotal ? [{ key: "total", header: "Total", align: "right", render: (r: GoodsReceiptHeader) => rupees(r.total) } satisfies Column<GoodsReceiptHeader>] : []),
    ...(withValue
      ? [{ key: "value", header: "Stock value", align: "right", render: (r: GoodsReceiptHeader) => (r.status === "draft" ? "—" : rupees(r.stockValue)) } satisfies Column<GoodsReceiptHeader>]
      : []),
  ];

  const total = receipts.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <h1>Goods receipts</h1>
      <p className="muted">Goods that arrived from suppliers, and goods sent back to them.</p>
      {rights.receive ? (
        <div className="toolbar">
          <Link href="/purchases/receipts/new" className="btn btn-primary">
            Receive goods
          </Link>
        </div>
      ) : null}
      <div className="filter-row">
        <SelectInput id="grn-status" label="Status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All</option>
          {(Object.keys(RECEIPT_STATUS_LABELS) as GoodsReceiptStatus[]).map((k) => (
            <option key={k} value={k}>
              {RECEIPT_STATUS_LABELS[k]}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="grn-store" label="Store" value={filters.storeId} onChange={(e) => setFilter("storeId", e.target.value)}>
          <option value="">All my stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="grn-kind" label="Show" value={filters.isReturn} onChange={(e) => setFilter("isReturn", e.target.value)}>
          <option value="">Receipts and returns</option>
          <option value="false">Receipts only</option>
          <option value="true">Returns only</option>
        </SelectInput>
        <SelectInput id="grn-terms" label="Terms" value={filters.isConsignment} onChange={(e) => setFilter("isConsignment", e.target.value)}>
          <option value="">All</option>
          <option value="false">Bought outright</option>
          <option value="true">Sale or return</option>
        </SelectInput>
        <TextInput id="grn-from" label="From" type="date" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
        <TextInput id="grn-to" label="To" type="date" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
        <PartyPicker
          id="grn-supplier"
          label="Supplier"
          kind="supplier"
          value={supplier}
          onChange={(p) => {
            setSupplier(p);
            setPage(1);
          }}
          hint="Leave empty for all suppliers."
        />
      </div>
      <Alert kind="error">{receipts.error ?? locations.error}</Alert>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading={receipts.loading} empty="No goods receipts match." />
      <div className="toolbar">
        <span className="muted">
          {total} document{total === 1 ? "" : "s"}
          {pageCount > 1 ? `, page ${page} of ${pageCount}` : ""}
        </span>
        <span className="spacer" />
        {pageCount > 1 ? (
          <>
            <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="small" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </>
        ) : null}
      </div>
    </>
  );
}
