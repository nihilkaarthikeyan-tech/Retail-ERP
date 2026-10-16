// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { Decimal } from "shared";
import { LedgerEntryButton } from "@/components/accounts/ledger-entry";
import { Alert, Button, DataTable, type Column } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime } from "@/lib/format";
import { canDraftKind, canFinaliseKind, indianTime, KIND_LABELS, locationLabel, reasonLabel, showQuantity } from "@/lib/stock";
import type { StockDocLineDto, StockDocumentDto, StockLocationDto, StoreRef } from "@/lib/types";
import { BackDatedBadge, CancelDocumentDialog, StockStatusBadge } from "./stock-doc-parts";

interface StockDocumentViewProps {
  doc: StockDocumentDto;
  locations: StockLocationDto[];
  stores: StoreRef[];
  onChanged: (doc: StockDocumentDto) => void;
}

function diff(counted: string | null, expected: string | null): string {
  if (counted === null || expected === null) return "—";
  try {
    const d = new Decimal(counted).sub(expected);
    return d.gt(0) ? `+${d.toString()}` : d.toString();
  } catch {
    return "—";
  }
}

/** A finalised or cancelled document (or a draft the user cannot change): read-only. */
export function StockDocumentView({ doc, locations, stores, onChanged }: StockDocumentViewProps) {
  const { user } = useAuth();
  const [cancelOpen, setCancelOpen] = useState(false);
  const loc = (id: string | null) => {
    if (!id) return "—";
    const l = locations.find((x) => x.id === id);
    return l ? locationLabel(l) : "—";
  };
  const store = (id: string | null) => {
    if (!id) return "—";
    const s = stores.find((x) => x.id === id);
    return s ? `${s.code} — ${s.name}` : "another store";
  };
  const withCost = doc.lines.some((l) => l.unitCost !== undefined);
  const isCount = doc.kind === "count";
  const isSend = doc.kind === "transfer_send";
  const anyBatch = doc.lines.some((l) => l.batch || l.newBatchNumber);
  const anySerial = doc.lines.some((l) => l.serialNumbers.length > 0);
  const canCancel =
    doc.status === "finalised" ? canFinaliseKind(user, doc.kind) && !(isSend && doc.lines.some((l) => new Decimal(l.receivedQuantity).gt(0))) : doc.status === "draft" && canDraftKind(user, doc.kind);
  const openToReceive = isSend && doc.status === "finalised" && doc.lines.some((l) => new Decimal(l.receivedQuantity).lt(l.basicQuantity));

  const columns: Column<StockDocLineDto>[] = [
    { key: "no", header: "#", render: (l) => l.lineNo },
    {
      key: "item",
      header: "Item",
      render: (l) => (
        <>
          <span className="mono">{l.item.code}</span> {l.item.name}
        </>
      ),
    },
    ...(isCount
      ? [
          { key: "expected", header: "Expected", align: "right", render: (l: StockDocLineDto) => (l.expectedQuantity === null ? <span className="muted">hidden</span> : showQuantity(l.expectedQuantity)) },
          { key: "counted", header: "Counted", align: "right", render: (l: StockDocLineDto) => showQuantity(l.countedQuantity) },
          { key: "diff", header: "Difference", align: "right", render: (l: StockDocLineDto) => diff(l.countedQuantity, l.expectedQuantity) },
        ] satisfies Column<StockDocLineDto>[]
      : [
          {
            key: "qty",
            header: "Quantity",
            align: "right",
            render: (l: StockDocLineDto) => (
              <>
                {showQuantity(l.quantity)}
                {showQuantity(l.factor) !== "1" ? <span className="muted"> (= {showQuantity(l.basicQuantity)} basic)</span> : null}
              </>
            ),
          },
        ] satisfies Column<StockDocLineDto>[]),
    ...(anyBatch
      ? [
          {
            key: "batch",
            header: "Batch",
            render: (l: StockDocLineDto) =>
              l.batch ? (
                <>
                  <span className="mono">{l.batch.batchNumber}</span>
                  {l.batch.expiryDate ? <span className="muted"> · expires {formatDate(l.batch.expiryDate)}</span> : null}
                </>
              ) : l.newBatchNumber ? (
                <span className="mono">{l.newBatchNumber} (new)</span>
              ) : l.item.trackBatches ? (
                <span className="muted">automatic</span>
              ) : (
                "—"
              ),
          } satisfies Column<StockDocLineDto>,
        ]
      : []),
    ...(anySerial ? [{ key: "serials", header: "Serial numbers", render: (l: StockDocLineDto) => (l.serialNumbers.length ? <span className="mono">{l.serialNumbers.join(", ")}</span> : "—") } satisfies Column<StockDocLineDto>] : []),
    ...(isSend
      ? [
          {
            key: "received",
            header: "Received",
            align: "right",
            render: (l: StockDocLineDto) => `${showQuantity(l.receivedQuantity)} of ${showQuantity(l.basicQuantity)}`,
          } satisfies Column<StockDocLineDto>,
        ]
      : []),
    ...(withCost
      ? [
          { key: "cost", header: "Cost per basic unit", align: "right", render: (l: StockDocLineDto) => l.unitCost ?? "—" },
          { key: "value", header: "Value change", align: "right", render: (l: StockDocLineDto) => (doc.status === "draft" ? "—" : (l.valueChange ?? "—")) },
        ] satisfies Column<StockDocLineDto>[]
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          {KIND_LABELS[doc.kind]} <span className="mono">{doc.number}</span>
        </h1>
        <StockStatusBadge status={doc.status} />
        <BackDatedBadge show={doc.isBackDated} />
        <span className="spacer" />
        {doc.status !== "draft" ? <LedgerEntryButton documentType="stock_document" documentId={doc.id} /> : null}
      </div>
      {doc.status === "cancelled" ? (
        <Alert kind="info">
          Cancelled{doc.cancelReason ? `: ${doc.cancelReason}` : ""}. {doc.finalisedAt ? "Reversing lines were posted; see Stock history." : ""}
        </Alert>
      ) : null}
      <div className="card">
        <dl className="kv">
          <dt>Store</dt>
          <dd>{store(doc.storeId)}</dd>
          {doc.reason ? (
            <>
              <dt>Reason</dt>
              <dd>{reasonLabel(doc.reason)}</dd>
            </>
          ) : null}
          {isCount ? (
            <>
              <dt>Type of count</dt>
              <dd>
                {doc.countType === "opening" ? "Opening stock" : "Normal count"}
                {doc.blind ? " · blind" : ""}
              </dd>
              <dt>Location counted</dt>
              <dd>{loc(doc.toLocationId)}</dd>
            </>
          ) : (
            <>
              {doc.fromLocationId ? (
                <>
                  <dt>From</dt>
                  <dd>{loc(doc.fromLocationId)}</dd>
                </>
              ) : null}
              {doc.toLocationId ? (
                <>
                  <dt>To</dt>
                  <dd>{loc(doc.toLocationId)}</dd>
                </>
              ) : null}
            </>
          )}
          {doc.toStoreId ? (
            <>
              <dt>Receiving store</dt>
              <dd>{store(doc.toStoreId)}</dd>
            </>
          ) : null}
          {doc.sendDocumentId ? (
            <>
              <dt>Received from</dt>
              <dd>
                <Link href={`/stock/documents/${doc.sendDocumentId}`}>the transfer sent</Link>
              </dd>
            </>
          ) : null}
          <dt>Posting date</dt>
          <dd>
            {formatDate(doc.postingDate)} {indianTime(doc.postingAt)}
          </dd>
          {doc.finalisedAt ? (
            <>
              <dt>Finalised</dt>
              <dd>{formatDateTime(doc.finalisedAt)}</dd>
            </>
          ) : null}
          {doc.remarks ? (
            <>
              <dt>Remarks</dt>
              <dd>{doc.remarks}</dd>
            </>
          ) : null}
          {doc.totalValueIn !== undefined && doc.status !== "draft" ? (
            <>
              <dt>Value in</dt>
              <dd>₹{doc.totalValueIn}</dd>
              <dt>Value out</dt>
              <dd>₹{doc.totalValueOut}</dd>
            </>
          ) : null}
        </dl>
      </div>

      <DataTable columns={columns} rows={doc.lines} rowKey={(l) => l.id} empty="No lines." />

      <div className="actions">
        {openToReceive ? (
          <Link href="/stock/transfers" className="btn btn-primary">
            Receive in the other store
          </Link>
        ) : null}
        {canCancel ? (
          <Button variant="danger" onClick={() => setCancelOpen(true)}>
            {doc.status === "draft" ? "Cancel draft" : "Cancel document"}
          </Button>
        ) : null}
      </div>
      {isSend && doc.status === "finalised" && !canCancel && canFinaliseKind(user, doc.kind) ? (
        <p className="muted">Goods from this transfer were already received; cancel the receipts first to cancel the transfer.</p>
      ) : null}
      <CancelDocumentDialog doc={doc} open={cancelOpen} onClose={() => setCancelOpen(false)} onCancelled={onChanged} />
    </>
  );
}
