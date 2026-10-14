// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { updatePriceSchema } from "shared";
import { Alert, Badge, Button, DataTable, Dialog, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatDate, todayIso } from "@/lib/format";
import type { PriceDto } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface PriceTableProps {
  rows: PriceDto[] | null | undefined;
  loading?: boolean;
  /** Show the item column (the prices page) or the list column (the item page). */
  showItem?: boolean;
  showList?: boolean;
  canManage: boolean;
  onChanged: () => Promise<void> | void;
}

function isEnded(p: PriceDto): boolean {
  return p.endDate !== null && p.endDate < todayIso();
}

/** Prices with "End today" and "Change price" actions; prices are never deleted. */
export function PriceTable({ rows, loading, showItem = false, showList = false, canManage, onChanged }: PriceTableProps) {
  const [rowError, setRowError] = useState<string | null>(null);
  const [changing, setChanging] = useState<PriceDto | null>(null);
  const [newPrice, setNewPrice] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function endToday(p: PriceDto) {
    setRowError(null);
    try {
      await api.patch(`/prices/${p.id}`, { endDate: todayIso() });
      await onChanged();
    } catch (err) {
      setRowError(errorMessage(err));
    }
  }

  function openChange(p: PriceDto) {
    setChanging(p);
    setNewPrice(p.price);
    setErrors({});
    setError(null);
  }

  async function submitChange(e: FormEvent) {
    e.preventDefault();
    if (!changing) return;
    setError(null);
    const parsed = updatePriceSchema.safeParse({ price: newPrice.trim() });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      await api.patch(`/prices/${changing.id}`, parsed.data);
      setChanging(null);
      await onChanged();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<PriceDto>[] = [
    ...(showItem
      ? [
          {
            key: "item",
            header: "Item",
            render: (p: PriceDto) => (
              <>
                <Link href={`/items/${p.item.id}`} className="mono">
                  {p.item.code}
                </Link>{" "}
                {p.item.name}
              </>
            ),
          } satisfies Column<PriceDto>,
        ]
      : []),
    ...(showList ? [{ key: "list", header: "Price list", render: (p: PriceDto) => p.priceList.name } satisfies Column<PriceDto>] : []),
    { key: "unit", header: "Unit", render: (p) => p.unit.code },
    { key: "price", header: "Price", align: "right", render: (p) => <span className="mono">{p.price}</span> },
    { key: "pack", header: "Pack size", align: "right", render: (p) => (p.packSize ? <span className="mono">{p.packSize}</span> : "—") },
    { key: "start", header: "From", render: (p) => formatDate(p.startDate) },
    {
      key: "end",
      header: "To",
      render: (p) => (
        <span className="row-actions">
          {p.endDate ? formatDate(p.endDate) : <span className="muted">open</span>}
          {isEnded(p) ? <Badge kind="off">Ended</Badge> : null}
          {p.customerId ? <Badge kind="neutral">Customer</Badge> : null}
          {p.supplierId ? <Badge kind="neutral">Supplier</Badge> : null}
        </span>
      ),
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            render: (p: PriceDto) => (
              <span className="row-actions">
                <Button size="small" onClick={() => openChange(p)}>
                  Change price
                </Button>
                {!isEnded(p) ? (
                  <Button size="small" variant="danger" onClick={() => endToday(p)}>
                    End today
                  </Button>
                ) : null}
              </span>
            ),
          } satisfies Column<PriceDto>,
        ]
      : []),
  ];

  return (
    <>
      <Alert kind="error">{rowError}</Alert>
      <DataTable columns={columns} rows={rows} rowKey={(p) => p.id} loading={loading} empty="No prices." />
      <Dialog open={changing !== null} title="Change price" onClose={() => setChanging(null)}>
        {changing ? (
          <form onSubmit={submitChange} noValidate>
            <Alert kind="info">The old and new price are written to the change history.</Alert>
            <Alert kind="error">{error}</Alert>
            <p>
              <span className="mono">{changing.item.code}</span> {changing.item.name} in {changing.priceList.name}, per {changing.unit.code}: currently{" "}
              <span className="mono">{changing.price}</span>.
            </p>
            <TextInput id="change-price" label="New price" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} error={errors.price} required inputMode="decimal" className="mono" />
            <div className="actions">
              <Button type="submit" variant="primary" busy={busy}>
                Save price
              </Button>
              <Button onClick={() => setChanging(null)}>Cancel</Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}
