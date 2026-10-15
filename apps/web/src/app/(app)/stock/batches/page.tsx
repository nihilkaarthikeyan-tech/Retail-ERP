// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { ItemPicker } from "@/components/prices/item-picker";
import { Alert, Badge, Button, DataTable, TextInput, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { locationLabel, showQuantity } from "@/lib/stock";
import type { BatchStockRow, ItemDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

export default function BatchesPage() {
  const [item, setItem] = useState<ItemDto | null>(null);
  const [daysText, setDaysText] = useState("");
  const [days, setDays] = useState("");
  const [daysError, setDaysError] = useState<string | null>(null);
  const batches = useLoad(() => api.get<BatchStockRow[]>(`/stock/batches${query({ itemId: item?.id, expiringWithinDays: days })}`), [item?.id, days]);

  function apply(e: FormEvent) {
    e.preventDefault();
    const t = daysText.trim();
    if (t && !/^\d{1,4}$/.test(t)) {
      setDaysError("Type a whole number of days, or leave blank for all batches");
      return;
    }
    setDaysError(null);
    setDays(t);
  }

  const columns: Column<BatchStockRow>[] = [
    {
      key: "item",
      header: "Item",
      render: (r) => (
        <>
          <span className="mono">{r.item.code}</span> {r.item.name}
        </>
      ),
    },
    { key: "batch", header: "Batch", render: (r) => <span className="mono">{r.batch.batchNumber}</span> },
    { key: "made", header: "Made on", render: (r) => formatDate(r.batch.manufactureDate) },
    { key: "expiry", header: "Expires on", render: (r) => formatDate(r.batch.expiryDate) },
    {
      key: "left",
      header: "Days left",
      align: "right",
      render: (r) => (r.daysLeft === null ? "—" : r.expired ? <Badge kind="off">Expired {Math.abs(r.daysLeft)} days ago</Badge> : r.daysLeft <= 30 ? <Badge kind="warn">{r.daysLeft}</Badge> : r.daysLeft),
    },
    { key: "location", header: "Location", render: (r) => locationLabel(r.location) },
    { key: "qty", header: "Quantity", align: "right", render: (r) => showQuantity(r.quantity) },
  ];

  return (
    <>
      <h1>Batches</h1>
      <p className="muted">Batches with stock, earliest expiry first. Expired batches cannot be sold, moved or received; they can only be written off with the reason &quot;Expired&quot;.</p>
      <form className="card" onSubmit={apply} noValidate>
        <ItemPicker id="batches-item" label="Item (optional)" value={item} onChange={setItem} />
        <div className="filter-row">
          <TextInput id="batches-days" label="Expiring within (days)" inputMode="numeric" value={daysText} onChange={(e) => setDaysText(e.target.value)} error={daysError} hint="Blank: all batches. Expired ones are always included." />
        </div>
        <div className="actions">
          <Button type="submit" variant="primary">
            Apply
          </Button>
        </div>
      </form>
      <Alert kind="error">{batches.error}</Alert>
      <DataTable
        columns={columns}
        rows={batches.data}
        rowKey={(r) => `${r.batch.id}-${r.location.id}`}
        loading={batches.loading}
        empty="No batches with stock match."
        rowClassName={(r) => (r.expired ? "row-alert" : r.daysLeft !== null && r.daysLeft <= 30 ? "row-warn" : undefined)}
      />
    </>
  );
}
