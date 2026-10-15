// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { ChargeStatusBadge, SHARE_BY_LABELS } from "@/components/purchasing/charges-view";
import { Alert, DataTable, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { type LandedChargeDto, purchaseRights, rupees } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";

export default function ChargesPage() {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const charges = useLoad(() => api.get<LandedChargeDto[]>("/purchase/charges"));
  const withTotal = (charges.data ?? []).some((c) => c.total !== undefined);

  const columns: Column<LandedChargeDto>[] = [
    {
      key: "number",
      header: "Number",
      render: (c) => (
        <Link href={`/purchases/charges/${c.id}`} className="mono">
          {c.number}
        </Link>
      ),
    },
    { key: "date", header: "Date", render: (c) => formatDate(c.postingDate) },
    { key: "share", header: "Shared", render: (c) => SHARE_BY_LABELS[c.shareBy] },
    { key: "receipts", header: "Receipts", align: "right", render: (c) => c.receiptIds.length },
    { key: "status", header: "Status", render: (c) => <ChargeStatusBadge status={c.status} /> },
    ...(withTotal ? [{ key: "total", header: "Total", align: "right", render: (c: LandedChargeDto) => rupees(c.total) } satisfies Column<LandedChargeDto>] : []),
  ];

  return (
    <>
      <h1>Freight and charges</h1>
      <p className="muted">Freight, loading or insurance paid on goods received. It is added to the cost of the goods, and later sales are re-costed.</p>
      {rights.charges ? (
        <div className="toolbar">
          <Link href="/purchases/charges/new" className="btn btn-primary">
            Add extra charges
          </Link>
        </div>
      ) : null}
      <Alert kind="error">{charges.error}</Alert>
      <DataTable columns={columns} rows={charges.data} rowKey={(c) => c.id} loading={charges.loading} empty="No extra charges yet." />
      <p className="muted">The latest 200 entries are shown.</p>
    </>
  );
}
