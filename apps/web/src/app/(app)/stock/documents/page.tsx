// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { hasPermission } from "shared";
import { BackDatedBadge, StockStatusBadge } from "@/components/stock/stock-doc-parts";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert, Button, DataTable, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { useModules } from "@/lib/modules";
import { KIND_LABELS, reasonLabel, STATUS_LABELS, storesFromLocations } from "@/lib/stock";
import type { StockDocHeaderDto, StockDocKindDto, StockDocPage } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

const PAGE_SIZE = 50;

export default function StockDocumentsPage() {
  const { user } = useAuth();
  const canCount = hasPermission(user, "stock.count");
  const canMove = hasPermission(user, "stock.move");
  // Plan 12: transfers between shops only while that module is on (old transfers still list).
  const transfersOn = useModules().isOn("transfers");
  const locations = useStockLocations();
  const [filters, setFilters] = useState({ kind: "", status: "", storeId: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const docs = useLoad(() => api.get<StockDocPage>(`/stock/documents${query({ ...filters, page, pageSize: PAGE_SIZE })}`), [filters.kind, filters.status, filters.storeId, filters.from, filters.to, page]);

  const stores = storesFromLocations(locations.data ?? []);
  const storeCode = (id: string | null) => (id ? (stores.find((s) => s.id === id)?.code ?? "other") : "—");
  const withValues = (docs.data?.rows ?? []).some((d) => d.totalValueIn !== undefined);

  function setFilter(key: keyof typeof filters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  const columns: Column<StockDocHeaderDto>[] = [
    {
      key: "number",
      header: "Number",
      render: (d) => (
        <Link href={`/stock/documents/${d.id}`} className="mono">
          {d.number}
        </Link>
      ),
    },
    { key: "date", header: "Date", render: (d) => formatDate(d.postingDate) },
    { key: "kind", header: "Kind", render: (d) => KIND_LABELS[d.kind] ?? d.kind },
    { key: "reason", header: "Reason", render: (d) => (d.kind === "count" ? (d.countType === "opening" ? "Opening stock" : "Normal count") : reasonLabel(d.reason)) },
    { key: "store", header: "Store", render: (d) => (d.toStoreId ? `${storeCode(d.storeId)} → ${storeCode(d.toStoreId)}` : storeCode(d.storeId)) },
    {
      key: "status",
      header: "Status",
      render: (d) => (
        <>
          <StockStatusBadge status={d.status} /> <BackDatedBadge show={d.isBackDated} />
        </>
      ),
    },
    ...(withValues
      ? [
          { key: "in", header: "Value in", align: "right", render: (d: StockDocHeaderDto) => (d.status === "draft" ? "—" : (d.totalValueIn ?? "—")) },
          { key: "out", header: "Value out", align: "right", render: (d: StockDocHeaderDto) => (d.status === "draft" ? "—" : (d.totalValueOut ?? "—")) },
        ] satisfies Column<StockDocHeaderDto>[]
      : []),
  ];

  const newLinks: { href: string; label: string; show: boolean }[] = [
    { href: "/stock/documents/new?kind=stock_in", label: "Stock in", show: canCount },
    { href: "/stock/documents/new?kind=stock_out", label: "Write-off", show: canCount },
    { href: "/stock/documents/new?kind=move", label: "Move within store", show: canMove },
    { href: "/stock/documents/new?kind=transfer_send", label: "Transfer to another store", show: canMove && transfersOn },
    { href: "/stock/counts/new", label: "Stock count", show: canCount },
  ];
  const total = docs.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <h1>Stock documents</h1>
      {newLinks.some((l) => l.show) ? (
        <div className="toolbar" role="group" aria-label="New">
          <strong>New:</strong>
          {newLinks
            .filter((l) => l.show)
            .map((l) => (
              <Link key={l.href} href={l.href} className="btn btn-secondary btn-small">
                {l.label}
              </Link>
            ))}
        </div>
      ) : null}
      <div className="filter-row">
        <SelectInput id="docs-kind" label="Kind" value={filters.kind} onChange={(e) => setFilter("kind", e.target.value)}>
          <option value="">All kinds</option>
          {(Object.keys(KIND_LABELS) as StockDocKindDto[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="docs-status" label="Status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="docs-store" label="Store" value={filters.storeId} onChange={(e) => setFilter("storeId", e.target.value)}>
          <option value="">All my stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
        <TextInput id="docs-from" label="From" type="date" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
        <TextInput id="docs-to" label="To" type="date" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
      </div>
      <Alert kind="error">{docs.error ?? locations.error}</Alert>
      <DataTable columns={columns} rows={docs.data?.rows} rowKey={(d) => d.id} loading={docs.loading} empty="No stock documents match." />
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
