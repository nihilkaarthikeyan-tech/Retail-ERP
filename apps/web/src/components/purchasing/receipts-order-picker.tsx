// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { Button, DataTable, type Column } from "@/components/ui";
import { api, query } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { ORDER_STATUS_LABELS, type Page, type PurchaseOrderHeader } from "@/lib/purchasing";
import { showQuantity } from "@/lib/stock";
import { useLoad } from "@/lib/use-load";

interface OrderPickerProps {
  supplierId: string;
  /** Orders whose lines are already on the receipt. */
  usedOrderIds: string[];
  busyOrderId: string | null;
  onPick: (order: PurchaseOrderHeader) => void;
}

/** Open orders of one supplier still waiting for goods; picking one adds its open lines. */
export function ReceiptsOrderPicker({ supplierId, usedOrderIds, busyOrderId, onPick }: OrderPickerProps) {
  const orders = useLoad(async () => {
    const statuses = ["to_receive_and_bill", "to_receive"] as const;
    const pages = await Promise.all(statuses.map((status) => api.get<Page<PurchaseOrderHeader>>(`/purchase/orders${query({ status, supplierId, pageSize: 100 })}`)));
    return pages.flatMap((p) => p.rows).sort((a, b) => a.neededBy.localeCompare(b.neededBy));
  }, [supplierId]);

  const columns: Column<PurchaseOrderHeader>[] = [
    { key: "number", header: "Order", render: (o) => <span className="mono">{o.number}</span> },
    { key: "date", header: "Ordered on", render: (o) => formatDate(o.orderDate) },
    { key: "needed", header: "Needed by", render: (o) => formatDate(o.neededBy) },
    { key: "store", header: "Store", render: (o) => o.store.code },
    { key: "status", header: "Status", render: (o) => ORDER_STATUS_LABELS[o.status] },
    { key: "received", header: "Received", align: "right", render: (o) => `${showQuantity(o.receivedPercent)}%` },
    {
      key: "add",
      header: "",
      render: (o) =>
        usedOrderIds.includes(o.id) ? (
          <span className="muted">Added</span>
        ) : (
          <Button size="small" busy={busyOrderId === o.id} disabled={busyOrderId !== null} onClick={() => onPick(o)}>
            Add its lines
          </Button>
        ),
    },
  ];

  return (
    <>
      {orders.error ? (
        <p className="field-error" role="alert">
          {orders.error}
        </p>
      ) : null}
      <DataTable columns={columns} rows={orders.data} rowKey={(o) => o.id} loading={orders.loading} empty="This supplier has no open orders waiting for goods." caption="Open orders of this supplier" />
    </>
  );
}
