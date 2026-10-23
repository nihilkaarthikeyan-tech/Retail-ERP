// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type BillPage, FlagBadges, type PosBillDto, useTills } from "@/components/pos/pos-shared";
import { Alert, Badge, Button, DataTable, EmptyState, PageHeader, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { indianTime } from "@/lib/stock";
import { useLoad } from "@/lib/use-load";

const PAGE_SIZE = 50;

export default function PosBillsPage() {
  const tills = useTills();
  const [filters, setFilters] = useState({ tillId: "", from: "", to: "", kind: "", search: "" });
  const [typed, setTyped] = useState("");
  const [page, setPage] = useState(1);
  const bills = useLoad(
    () => api.get<BillPage>(`/pos/bills${query({ tillId: filters.tillId, from: filters.from, to: filters.to, kind: filters.kind, search: filters.search, page, pageSize: PAGE_SIZE })}`),
    [filters.tillId, filters.from, filters.to, filters.kind, filters.search, page],
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

  const columns: Column<PosBillDto>[] = [
    {
      key: "number",
      header: "Number",
      render: (b) => (
        <Link href={`/pos/bills/${b.id}`} className="mono">
          {b.number}
        </Link>
      ),
    },
    { key: "date", header: "Date", render: (b) => `${formatDate(b.businessDate)} ${indianTime(b.soldAt)}` },
    { key: "till", header: "Till", render: (b) => <span className="mono">{b.till.code}</span> },
    {
      key: "kind",
      header: "Kind",
      render: (b) => (
        <span className="row-actions">
          {b.kind === "return" ? "Return" : "Sale"}
          {b.exchangeId ? <Badge kind="neutral">Exchange</Badge> : null}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (b) => (b.status === "cancelled" ? <Badge kind="off">Cancelled</Badge> : <Badge kind="ok">Completed</Badge>) },
    { key: "paid", header: "Paid by", render: (b) => b.payments.map((p) => p.paymentMethod.name).join(", ") || "—" },
    { key: "flags", header: "To check", render: (b) => <FlagBadges flags={b.checkFlags.filter((f) => f !== "gst_provisional")} /> },
    { key: "total", header: "Total", align: "right", render: (b) => rupees(b.total) },
  ];

  const total = bills.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Till bills" note="Every bill and return made at the billing counter." />
      <div className="filter-row">
        <TextInput id="pb-search" label="Bill number" placeholder="Part of the number" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <SelectInput id="pb-till" label="Till" value={filters.tillId} onChange={(e) => setFilter("tillId", e.target.value)}>
          <option value="">All tills</option>
          {(tills.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.code} — {t.name}
            </option>
          ))}
        </SelectInput>
        <TextInput id="pb-from" label="From" type="date" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
        <TextInput id="pb-to" label="To" type="date" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
        <SelectInput id="pb-kind" label="Kind" value={filters.kind} onChange={(e) => setFilter("kind", e.target.value)}>
          <option value="">Sales and returns</option>
          <option value="sale">Sales</option>
          <option value="return">Returns</option>
        </SelectInput>
      </div>
      <Alert kind="error">{bills.error ?? tills.error}</Alert>
      <DataTable columns={columns} rows={bills.data?.rows} rowKey={(b) => b.id} loading={bills.loading} empty={
          filters.search || filters.tillId || filters.from || filters.to || filters.kind ? (
            "No bills match."
          ) : (
            <EmptyState title="No bills yet" text="Bills made at the billing counter appear here as soon as they are saved.">
              <Link href="/till" className="btn btn-primary">
                Open the billing counter
              </Link>
            </EmptyState>
          )
        }
        rowClassName={(b) => (b.status === "cancelled" ? "row-muted" : undefined)} />
      <div className="toolbar">
        <span className="muted">
          {total} bill{total === 1 ? "" : "s"}
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
