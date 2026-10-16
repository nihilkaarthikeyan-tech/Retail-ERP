// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, Button, DataTable, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { showQuantity } from "@/lib/stock";
import { useLoad } from "@/lib/use-load";

/** One financial year's totals (GET /customers/:id/purchases). */
export interface PurchaseYearDto {
  name: string;
  from: string;
  to: string;
  bills: number;
  returns: number;
  /** Before GST, returns taken off: equals the item-sales report for this customer. */
  netSales: string;
  /** What the customer paid, with GST, returns taken off. */
  total: string;
  quantity: string;
}

export interface CustomerPurchaseRow {
  id: string;
  number: string;
  kind: "sale" | "return";
  status: "completed" | "cancelled";
  date: string;
  soldAt: string;
  store: { id: string; code: string; name: string };
  returnOfId: string | null;
  lines: number;
  quantity: string;
  netAmount: string;
  amount: string;
}

export interface CustomerPurchasesDto {
  customerId: string;
  isWalkIn: boolean;
  thisYear: PurchaseYearDto | null;
  lastYear: PurchaseYearDto | null;
  page: number;
  pageSize: number;
  total: number;
  rows: CustomerPurchaseRow[];
}

function YearCard({ title, year }: { title: string; year: PurchaseYearDto | null }) {
  return (
    <section className="card" aria-label={title}>
      <h3>
        {title}
        {year ? ` (${year.name})` : ""}
      </h3>
      {year ? (
        <dl className="kv">
          <dt>Bought (with GST)</dt>
          <dd>
            <strong>{rupees(year.total)}</strong>
          </dd>
          <dt>Net sales before GST</dt>
          <dd>{rupees(year.netSales)}</dd>
          <dt>Bills / returns</dt>
          <dd>
            {year.bills} / {year.returns}
          </dd>
          <dt>Items (less returns)</dt>
          <dd>{showQuantity(year.quantity)}</dd>
        </dl>
      ) : (
        <p className="muted">No financial year set up for this period.</p>
      )}
    </section>
  );
}

/** The customer's "Purchases" tab (plan 11 C9): till bills and returns, newest first. */
export function CustomerPurchases({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const q = query({ page: page > 1 ? String(page) : undefined });
  const p = useLoad(() => api.get<CustomerPurchasesDto>(`/customers/${customerId}/purchases${q}`), [customerId, q]);
  const columns: Column<CustomerPurchaseRow>[] = [
    { key: "date", header: "Date", render: (r) => formatDate(r.date) },
    { key: "store", header: "Store", render: (r) => r.store.code },
    {
      key: "number",
      header: "Bill",
      render: (r) => (
        <>
          <Link href={`/pos/bills/${r.id}`} className="mono">
            {r.number}
          </Link>{" "}
          {r.kind === "return" ? <Badge kind="warn">Return</Badge> : null} {r.status === "cancelled" ? <Badge kind="off">Cancelled</Badge> : null}
        </>
      ),
    },
    { key: "items", header: "Items", align: "right", render: (r) => showQuantity(r.quantity) },
    { key: "amount", header: "Amount", align: "right", render: (r) => <span className={r.amount.startsWith("-") ? "num-negative" : undefined}>{rupees(r.amount)}</span> },
  ];
  if (p.error) return <Alert kind="error">{p.error}</Alert>;
  const d = p.data;
  const pageCount = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  return (
    <>
      {d?.isWalkIn ? <Alert kind="info">The walk-in customer stands for every unnamed buyer, so these are all bills without a named customer.</Alert> : null}
      {d ? (
        <div className="form-grid">
          <YearCard title="This financial year" year={d.thisYear} />
          <YearCard title="Last financial year" year={d.lastYear} />
        </div>
      ) : null}
      <p className="muted">Till bills and returns, newest first. Cancelled bills are listed but not counted in the totals.</p>
      <DataTable columns={columns} rows={d?.rows} rowKey={(r) => r.id} loading={p.loading} empty="No bills for this customer yet." rowClassName={(r) => (r.status === "cancelled" ? "row-muted" : undefined)} />
      {pageCount > 1 ? (
        <div className="toolbar">
          <span className="muted">
            Page {page} of {pageCount} ({d?.total} bills)
          </span>
          <span className="spacer" />
          <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Newer
          </Button>
          <Button size="small" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
            Older
          </Button>
        </div>
      ) : null}
    </>
  );
}
