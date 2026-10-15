// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { Alert, DataTable, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { locationLabel, showQuantity } from "@/lib/stock";
import type { NegativeStockRow } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

export default function NegativeStockPage() {
  const rows = useLoad(() => api.get<NegativeStockRow[]>("/stock/exceptions/negative"));

  const columns: Column<NegativeStockRow>[] = [
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
    { key: "qty", header: "Quantity", align: "right", render: (r) => <span className="num-negative">{showQuantity(r.quantity)}</span> },
    { key: "since", header: "Last movement", render: (r) => formatDateTime(r.since) },
  ];

  return (
    <>
      <h1>Negative stock</h1>
      <p className="muted">
        Items that went below zero (allowed only at the till, so a sale is never stopped). Each one needs looking into: usually a missing receipt or a wrong
        item scanned. Fix it with a stock in, a count or by receiving the missing goods; see <Link href="/stock/ledger">Stock history</Link> for the movements.
      </p>
      <Alert kind="error">{rows.error}</Alert>
      <DataTable columns={columns} rows={rows.data} rowKey={(r) => `${r.item?.id ?? "?"}-${r.location.id}`} loading={rows.loading} empty="No negative stock. All good." />
    </>
  );
}
