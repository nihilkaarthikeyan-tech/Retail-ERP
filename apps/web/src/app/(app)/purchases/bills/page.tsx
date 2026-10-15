// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { PartyPicker } from "@/components/parties/party-picker";
import { BillBadges } from "@/components/purchasing/bills-view";
import { Alert, Badge, Button, CheckInput, DataTable, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { BILL_KIND_LABELS, BILL_STATUS_LABELS, type Page, purchaseRights, rupees, type SupplierBillHeader, type SupplierBillKind, type SupplierBillStatus } from "@/lib/purchasing";
import type { PartyRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

const PAGE_SIZE = 50;

export default function SupplierBillsPage() {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const [filters, setFilters] = useState({ status: "", kind: "", held: false, dueBy: "" });
  const [supplier, setSupplier] = useState<PartyRef | null>(null);
  const [page, setPage] = useState(1);
  const bills = useLoad(
    () =>
      api.get<Page<SupplierBillHeader>>(
        `/purchase/bills${query({ status: filters.status, kind: filters.kind, supplierId: supplier?.id, held: filters.held ? "true" : undefined, dueBy: filters.dueBy, page, pageSize: PAGE_SIZE })}`,
      ),
    [filters.status, filters.kind, filters.held, filters.dueBy, supplier?.id, page],
  );
  const withTotals = (bills.data?.rows ?? []).some((b) => b.total !== undefined);

  function setFilter<K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  const columns: Column<SupplierBillHeader>[] = [
    {
      key: "number",
      header: "Our number",
      render: (b) => (
        <Link href={`/purchases/bills/${b.id}`} className="mono">
          {b.number}
        </Link>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      render: (b) => (
        <>
          <span className="mono">{b.supplier.code}</span> {b.supplier.name}
        </>
      ),
    },
    {
      key: "theirs",
      header: "Supplier's bill",
      render: (b) => (
        <>
          <span className="mono">{b.supplierBillNo}</span>
          <div className="muted">{formatDate(b.supplierBillDate)}</div>
        </>
      ),
    },
    { key: "kind", header: "Kind", render: (b) => BILL_KIND_LABELS[b.kind] },
    { key: "status", header: "Status", render: (b) => <BillBadges bill={{ ...b, overdue: false }} /> },
    {
      key: "due",
      header: "Due",
      render: (b) =>
        b.kind === "debit_note" ? (
          "—"
        ) : (
          <>
            {formatDate(b.dueDate)} {b.overdue ? <Badge kind="off">Overdue</Badge> : null}
          </>
        ),
    },
    ...(withTotals ? ([{ key: "total", header: "Total", align: "right", render: (b) => rupees(b.total) }] satisfies Column<SupplierBillHeader>[]) : []),
  ];

  const total = bills.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <h1>Supplier bills</h1>
      {rights.bill ? (
        <div className="toolbar">
          <Link href="/purchases/bills/new" className="btn btn-primary">
            Record supplier bill
          </Link>
        </div>
      ) : null}
      <div className="filter-row">
        <SelectInput id="bills-status" label="Status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All</option>
          {(Object.keys(BILL_STATUS_LABELS) as SupplierBillStatus[]).map((s) => (
            <option key={s} value={s}>
              {BILL_STATUS_LABELS[s]}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="bills-kind" label="Kind" value={filters.kind} onChange={(e) => setFilter("kind", e.target.value)}>
          <option value="">All kinds</option>
          {(Object.keys(BILL_KIND_LABELS) as SupplierBillKind[]).map((k) => (
            <option key={k} value={k}>
              {BILL_KIND_LABELS[k]}
            </option>
          ))}
        </SelectInput>
        <PartyPicker
          id="bills-supplier"
          label="Supplier"
          kind="supplier"
          value={supplier}
          onChange={(p) => {
            setSupplier(p);
            setPage(1);
          }}
          hint="Leave empty for all suppliers."
        />
        <TextInput id="bills-due" label="Due by" type="date" value={filters.dueBy} onChange={(e) => setFilter("dueBy", e.target.value)} hint="Unpaid bills due on or before this date." />
        <CheckInput id="bills-held" label="Held bills only" checked={filters.held} onChange={(e) => setFilter("held", e.target.checked)} />
      </div>
      <Alert kind="error">{bills.error}</Alert>
      <DataTable columns={columns} rows={bills.data?.rows} rowKey={(b) => b.id} loading={bills.loading} empty="No supplier bills match." />
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
