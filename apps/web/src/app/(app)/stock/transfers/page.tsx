// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { Decimal, hasPermission } from "shared";
import { ReceiveDialog } from "@/components/stock/receive-dialog";
import { useCompanyStores, useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert, Button, DataTable, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { showQuantity } from "@/lib/stock";
import type { StockDocumentDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

function progress(d: StockDocumentDto): string {
  let sent = new Decimal(0);
  let received = new Decimal(0);
  for (const l of d.lines) {
    sent = sent.add(l.basicQuantity);
    received = received.add(l.receivedQuantity);
  }
  return `${showQuantity(received.toString())} of ${showQuantity(sent.toString())}`;
}

export default function InTransitPage() {
  const { user } = useAuth();
  const canReceive = hasPermission(user, "stock.move");
  const sends = useLoad(() => api.get<StockDocumentDto[]>("/stock/transfers/in-transit"));
  const locations = useStockLocations();
  const stores = useCompanyStores(locations.data);
  const [receiving, setReceiving] = useState<StockDocumentDto | null>(null);
  const [done, setDone] = useState<StockDocumentDto | null>(null);

  const mine = (storeId: string | null) => !!storeId && (user?.allStores || (user?.stores ?? []).some((s) => s.id === storeId));
  const storeName = (id: string | null) => {
    const s = stores.stores.find((x) => x.id === id);
    return s ? `${s.code} — ${s.name}` : "another store";
  };
  const incoming = (sends.data ?? []).filter((d) => mine(d.toStoreId));
  const outgoing = (sends.data ?? []).filter((d) => !mine(d.toStoreId));

  const base: Column<StockDocumentDto>[] = [
    {
      key: "number",
      header: "Transfer",
      render: (d) => (
        <Link href={`/stock/documents/${d.id}`} className="mono">
          {d.number}
        </Link>
      ),
    },
    { key: "date", header: "Sent on", render: (d) => formatDate(d.postingDate) },
    { key: "from", header: "From", render: (d) => storeName(d.storeId) },
    { key: "to", header: "To", render: (d) => storeName(d.toStoreId) },
    { key: "lines", header: "Items", align: "right", render: (d) => d.lines.length },
    { key: "received", header: "Received", align: "right", render: (d) => progress(d) },
  ];
  const incomingColumns: Column<StockDocumentDto>[] = [
    ...base,
    ...(canReceive
      ? [
          {
            key: "act",
            header: "",
            render: (d: StockDocumentDto) => (
              <Button size="small" variant="primary" onClick={() => setReceiving(d)}>
                Receive
              </Button>
            ),
          } satisfies Column<StockDocumentDto>,
        ]
      : []),
  ];

  return (
    <>
      <h1>In transit</h1>
      <p className="muted">Transfers that left one store and have not yet all arrived at the other. Receive them when the goods arrive; part of a transfer can be received now and the rest later.</p>
      <Alert kind="error">{sends.error ?? locations.error}</Alert>
      {done ? (
        <Alert kind="success">
          Received as{" "}
          <Link href={`/stock/documents/${done.id}`} className="mono">
            {done.number}
          </Link>
          .
        </Alert>
      ) : null}
      <h2>Coming to your stores</h2>
      <DataTable columns={incomingColumns} rows={sends.data ? incoming : null} rowKey={(d) => d.id} loading={sends.loading} empty="Nothing is on its way to your stores." />
      {/* Launch check, 27 October 2026: for someone who looks after every store, every transfer is
          "coming to your stores", and a second empty list only confused. */}
      {user?.allStores ? null : (
        <>
          <h2>Sent to stores you do not look after</h2>
          <DataTable columns={base} rows={sends.data ? outgoing : null} rowKey={(d) => d.id} loading={sends.loading} empty="Nothing you sent to other stores is still on its way." />
        </>
      )}
      {receiving && locations.data ? (
        <ReceiveDialog
          send={receiving}
          locations={locations.data}
          onClose={() => setReceiving(null)}
          onReceived={(receipt) => {
            setReceiving(null);
            setDone(receipt);
            void sends.reload();
          }}
        />
      ) : null}
    </>
  );
}
