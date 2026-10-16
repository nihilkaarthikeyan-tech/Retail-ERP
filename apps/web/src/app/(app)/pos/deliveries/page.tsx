// Copyright (c) 2026, Rademics. All rights reserved.
// Home deliveries (plan 11 B4; decisions 46 and 47): each store's pending,
// delivered and cancelled deliveries of till bills. A manager marks one
// delivered, which records who and when. No pick lists or delivery trips.
"use client";

import Link from "next/link";
import { useState } from "react";
import { hasPermission } from "shared";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert, Badge, Button, DataTable, Dialog, SelectInput, TextareaInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime } from "@/lib/format";
import { rupees } from "@/lib/purchasing";
import { storesFromLocations } from "@/lib/stock";
import { useLoad } from "@/lib/use-load";

type Status = "pending" | "delivered" | "cancelled";

interface DeliveryRow {
  id: string;
  billId: string;
  name: string | null;
  address: string;
  phone: string | null;
  deliverOn: string | null;
  status: Status;
  chargeAmount: string;
  deliveredAt: string | null;
  deliveredBy: string | null;
  remarks: string | null;
  store: { id: string; code: string; name: string } | null;
  bill: { id: string; number: string; total: string; businessDate: string | null } | null;
}

const STATUS: Record<Status, { label: string; kind: "warn" | "ok" | "off" }> = {
  pending: { label: "Pending", kind: "warn" },
  delivered: { label: "Delivered", kind: "ok" },
  cancelled: { label: "Cancelled", kind: "off" },
};

export default function DeliveriesPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "deliveries.manage");
  const locations = useStockLocations();
  const stores = storesFromLocations(locations.data ?? []);
  const [filters, setFilters] = useState<{ storeId: string; status: Status | "" }>({ storeId: "", status: "pending" });
  const rows = useLoad(() => api.get<{ rows: DeliveryRow[]; total: number }>(`/pos/deliveries${query({ storeId: filters.storeId || undefined, status: filters.status || undefined, pageSize: "200" })}`), [filters.storeId, filters.status]);
  const [acting, setActing] = useState<{ row: DeliveryRow; action: "delivered" | "cancel" } | null>(null);
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act() {
    if (!acting) return;
    setError(null);
    if (acting.action === "cancel" && !remarks.trim()) return setError("Give the reason for cancelling the delivery.");
    setBusy(true);
    try {
      await api.post(`/pos/deliveries/${acting.row.id}/${acting.action}`, { remarks: remarks.trim() || null });
      setActing(null);
      await rows.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<DeliveryRow>[] = [
    { key: "bill", header: "Bill", render: (r) => (r.bill ? <Link href={`/pos/bills/${r.bill.id}`} className="mono">{r.bill.number}</Link> : "—") },
    { key: "store", header: "Store", render: (r) => r.store?.code ?? "—" },
    { key: "deliverOn", header: "Deliver on", render: (r) => (r.deliverOn ? formatDate(r.deliverOn) : "—") },
    {
      key: "to",
      header: "Deliver to",
      render: (r) => (
        <>
          {r.name ? <strong>{r.name}</strong> : null}
          <div>{r.address}</div>
          {r.phone ? <div className="muted">{r.phone}</div> : null}
        </>
      ),
    },
    { key: "charge", header: "Charge", align: "right", render: (r) => rupees(r.chargeAmount) },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <>
          <Badge kind={STATUS[r.status].kind}>{STATUS[r.status].label}</Badge>
          {r.deliveredAt ? (
            <div className="muted">
              {formatDateTime(r.deliveredAt)}
              {r.deliveredBy ? `, ${r.deliveredBy}` : ""}
            </div>
          ) : null}
          {r.remarks ? <div className="muted">{r.remarks}</div> : null}
        </>
      ),
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            render: (r: DeliveryRow) =>
              r.status === "pending" ? (
                <span className="row-actions">
                  <Button
                    size="small"
                    variant="primary"
                    onClick={() => {
                      setRemarks("");
                      setError(null);
                      setActing({ row: r, action: "delivered" });
                    }}
                  >
                    Mark delivered
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setRemarks("");
                      setError(null);
                      setActing({ row: r, action: "cancel" });
                    }}
                  >
                    Cancel
                  </Button>
                </span>
              ) : null,
          } satisfies Column<DeliveryRow>,
        ]
      : []),
  ];

  return (
    <>
      <h1>Home deliveries</h1>
      <p className="muted">Bills the till marked for home delivery. The delivery charge is set per store in the till settings.</p>
      <div className="filter-row">
        <SelectInput id="del-store" label="Store" value={filters.storeId} onChange={(e) => setFilters({ ...filters, storeId: e.target.value })}>
          <option value="">All my stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="del-status" label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as Status | "" })}>
          <option value="">All</option>
          {(Object.keys(STATUS) as Status[]).map((k) => (
            <option key={k} value={k}>
              {STATUS[k].label}
            </option>
          ))}
        </SelectInput>
      </div>
      <Alert kind="error">{rows.error}</Alert>
      <DataTable columns={columns} rows={rows.data?.rows ?? null} rowKey={(r) => r.id} loading={rows.loading} empty="No deliveries." />
      <Dialog open={acting !== null} title={acting?.action === "cancel" ? "Cancel the delivery" : "Mark delivered"} onClose={() => setActing(null)}>
        {acting ? (
          <p>
            Bill <span className="mono">{acting.row.bill?.number}</span> to {acting.row.name ? `${acting.row.name}, ` : ""}
            {acting.row.address}
          </p>
        ) : null}
        <Alert kind="error">{error}</Alert>
        <TextareaInput id="del-remarks" label={acting?.action === "cancel" ? "Reason" : "Remarks (optional)"} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        <div className="actions">
          <Button variant="primary" busy={busy} onClick={() => void act()}>
            {acting?.action === "cancel" ? "Cancel the delivery" : "Mark delivered"}
          </Button>
          <Button onClick={() => setActing(null)}>Close</Button>
        </div>
      </Dialog>
    </>
  );
}
