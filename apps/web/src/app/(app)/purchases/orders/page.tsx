// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OrderStatusBadge, useOrderStores } from "@/components/purchasing/orders-shared";
import { Alert, Badge, Button, CheckInput, DataTable, EmptyState, PageHeader, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { ORDER_STATUS_LABELS, type Page, type PurchaseOrderHeader, purchaseRights, rupees } from "@/lib/purchasing";
import { showQuantity } from "@/lib/stock";
import { useLoad } from "@/lib/use-load";

const PAGE_SIZE = 50;

export default function PurchaseOrdersPage() {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const stores = useOrderStores();
  const [filters, setFilters] = useState({ status: "", storeId: "", search: "", overdue: false });
  const [typed, setTyped] = useState("");
  const [page, setPage] = useState(1);
  const orders = useLoad(
    () =>
      api.get<Page<PurchaseOrderHeader>>(
        `/purchase/orders${query({ status: filters.status, storeId: filters.storeId, search: filters.search, overdue: filters.overdue ? "true" : undefined, page, pageSize: PAGE_SIZE })}`,
      ),
    [filters.status, filters.storeId, filters.search, filters.overdue, page],
  );

  // Search after a short pause in typing, not on every key.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === typed.trim() ? f : { ...f, search: typed.trim() }));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [typed]);

  function setFilter<K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  const withTotals = (orders.data?.rows ?? []).some((o) => o.total !== undefined);
  const columns: Column<PurchaseOrderHeader>[] = [
    {
      key: "number",
      header: "Number",
      render: (o) => (
        <Link href={`/purchases/orders/${o.id}`} className="mono">
          {o.number}
        </Link>
      ),
    },
    { key: "date", header: "Date", render: (o) => formatDate(o.orderDate) },
    { key: "supplier", header: "Supplier", render: (o) => o.supplier.name },
    { key: "store", header: "Store", render: (o) => o.store.code },
    {
      key: "needed",
      header: "Needed by",
      render: (o) => (
        <>
          {formatDate(o.neededBy)} {o.overdue ? <Badge kind="off">Overdue</Badge> : null}
        </>
      ),
    },
    { key: "status", header: "Status", render: (o) => <OrderStatusBadge status={o.status} /> },
    { key: "received", header: "Received", align: "right", render: (o) => `${showQuantity(o.receivedPercent)}%` },
    { key: "billed", header: "Billed", align: "right", render: (o) => `${showQuantity(o.billedPercent)}%` },
    ...(withTotals ? ([{ key: "total", header: "Total", align: "right", render: (o: PurchaseOrderHeader) => rupees(o.total) }] satisfies Column<PurchaseOrderHeader>[]) : []),
  ];

  const total = orders.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Purchase orders">
        {rights.order ? (
          <Link href="/purchases/orders/new" className="btn btn-primary">
            New purchase order
          </Link>
        ) : null}
      </PageHeader>
      <div className="filter-row">
        <TextInput id="po-search" label="Search" placeholder="Order number or supplier" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <SelectInput id="po-status" label="Status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="po-store" label="Store" value={filters.storeId} onChange={(e) => setFilter("storeId", e.target.value)}>
          <option value="">All my stores</option>
          {stores.stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
        <CheckInput id="po-overdue" label="Overdue only" description="Goods still expected after the needed-by date" checked={filters.overdue} onChange={(e) => setFilter("overdue", e.target.checked)} />
      </div>
      <Alert kind="error">{orders.error ?? stores.error}</Alert>
      <DataTable columns={columns} rows={orders.data?.rows} rowKey={(o) => o.id} loading={orders.loading} empty={
          typed.trim() ? (
            "No purchase orders match."
          ) : (
            <EmptyState title="No purchase orders yet" text="Order stock from a supplier here; the goods are received against the order when they arrive.">
              {rights.order ? (
                <Link href="/purchases/orders/new" className="btn btn-primary">
                  New purchase order
                </Link>
              ) : null}
            </EmptyState>
          )
        }
      />
      <div className="toolbar">
        <span className="muted">
          {total} order{total === 1 ? "" : "s"}
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
