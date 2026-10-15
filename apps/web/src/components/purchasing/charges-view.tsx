// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, Button, DataTable } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime } from "@/lib/format";
import { CHARGE_TYPE_LABELS, type GoodsReceiptHeader, type LandedChargeDto, purchaseRights, rupees, statusTone } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";
import { ReasonDialog } from "./receipts-parts";

export const CHARGE_STATUS_LABELS: Record<LandedChargeDto["status"], string> = {
  draft: "Draft",
  finalised: "Finalised",
  cancelled: "Cancelled",
};

export const SHARE_BY_LABELS: Record<LandedChargeDto["shareBy"], string> = {
  quantity: "By quantity",
  value: "By value",
  manual: "By hand",
};

export function ChargeStatusBadge({ status }: { status: LandedChargeDto["status"] }) {
  return <Badge kind={statusTone(status)}>{CHARGE_STATUS_LABELS[status] ?? status}</Badge>;
}

interface ChargesViewProps {
  charge: LandedChargeDto;
  onChanged: (charge: LandedChargeDto) => void;
}

/** One extra-charge entry: its charges, the share of each received line, Finalise and Cancel. */
export function ChargesView({ charge: c, onChanged }: ChargesViewProps) {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const numbers = useLoad<Record<string, string>>(async () => {
    const rows = await Promise.all(c.receiptIds.map((id) => api.get<GoodsReceiptHeader>(`/purchase/receipts/${id}`).then((r) => [id, r.number] as const, () => [id, ""] as const)));
    return Object.fromEntries(rows.filter(([, n]) => n));
  }, [c.receiptIds.join(",")]);

  async function finalise() {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.post<LandedChargeDto>(`/purchase/charges/${c.id}/finalise`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>
          Extra charges <span className="mono">{c.number}</span>
        </h1>
        <ChargeStatusBadge status={c.status} />
      </div>
      <p className="muted">The charges are added to the cost of the goods received, and sales made since then are re-costed.</p>
      {c.status === "draft" ? <Alert kind="info">This is a draft: the costs change only when it is finalised.</Alert> : null}
      {c.status === "cancelled" ? <Alert kind="info">{`Cancelled${c.cancelReason ? `: ${c.cancelReason}` : ""}. ${c.finalisedAt ? "The costs were put back as they were." : ""}`}</Alert> : null}

      <div className="card">
        <dl className="kv">
          <dt>Date</dt>
          <dd>{formatDate(c.postingDate)}</dd>
          <dt>Shared</dt>
          <dd>{SHARE_BY_LABELS[c.shareBy]}</dd>
          <dt>Goods receipts</dt>
          <dd>
            {c.receiptIds.map((id, i) => (
              <span key={id}>
                {i > 0 ? ", " : ""}
                <Link href={`/purchases/receipts/${id}`} className="mono">
                  {numbers.data?.[id] ?? `receipt ${i + 1}`}
                </Link>
              </span>
            ))}
          </dd>
          {c.total !== undefined ? (
            <>
              <dt>Total</dt>
              <dd>
                <strong>{rupees(c.total)}</strong>
              </dd>
            </>
          ) : null}
          {c.finalisedAt ? (
            <>
              <dt>Finalised</dt>
              <dd>{formatDateTime(c.finalisedAt)}</dd>
            </>
          ) : null}
          {c.remarks ? (
            <>
              <dt>Remarks</dt>
              <dd>{c.remarks}</dd>
            </>
          ) : null}
        </dl>
      </div>

      {c.charges ? (
        <>
          <h2>Charges</h2>
          <DataTable
            columns={[
              { key: "desc", header: "Description", render: (x) => x.description },
              { key: "type", header: "Type", render: (x) => CHARGE_TYPE_LABELS[x.chargeType] ?? x.chargeType },
              { key: "amount", header: "Amount", align: "right", render: (x) => rupees(x.amount) },
            ]}
            rows={c.charges}
            rowKey={(x) => `${x.description}-${x.amount}-${x.chargeType}`}
          />
        </>
      ) : null}
      {c.shares ? (
        <>
          <h2>Share of each line</h2>
          <DataTable
            columns={[
              { key: "receipt", header: "Receipt", render: (s) => <span className="mono">{s.receipt}</span> },
              { key: "item", header: "Item", render: (s) => `${s.item.code} ${s.item.name}` },
              { key: "amount", header: "Share", align: "right", render: (s) => rupees(s.amount) },
            ]}
            rows={c.shares}
            rowKey={(s) => s.receiptLineId}
          />
        </>
      ) : (
        <p className="muted">Amounts are shown only to people who may see buying prices or stock costs.</p>
      )}

      <Alert kind="error">{error}</Alert>
      <div className="actions">
        {c.status === "draft" && rights.charges ? (
          <Button variant="primary" busy={busy} onClick={finalise}>
            Finalise
          </Button>
        ) : null}
        {c.status !== "cancelled" && rights.charges ? (
          <Button variant="danger" disabled={busy} onClick={() => setCancelOpen(true)}>
            {c.status === "draft" ? "Cancel draft" : "Cancel the charges"}
          </Button>
        ) : null}
        <Link href="/purchases/charges" className="btn btn-secondary">
          Back to the list
        </Link>
      </div>
      <ReasonDialog<LandedChargeDto>
        open={cancelOpen}
        title={`Cancel ${c.number}`}
        explanation={c.status === "draft" ? "The draft is kept, marked as cancelled. No cost changes." : "Cancelling takes the charges back off the cost of the goods, and later sales are re-costed again."}
        path={`/purchase/charges/${c.id}/cancel`}
        confirmLabel="Cancel the charges"
        danger
        onClose={() => setCancelOpen(false)}
        onDone={onChanged}
      />
    </>
  );
}
