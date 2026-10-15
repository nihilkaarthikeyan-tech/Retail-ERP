// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ReceiptEditor } from "@/components/purchasing/receipts-editor";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { purchaseRights } from "@/lib/purchasing";

export function NewReceipt() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const rights = purchaseRights(user);
  const orderId = params.get("orderId");
  const locations = useStockLocations();

  return (
    <>
      <p>
        <Link href="/purchases/receipts">← Goods receipts</Link>
      </p>
      {!rights.receive ? (
        <Alert kind="error">You do not have the right to receive goods.</Alert>
      ) : locations.error ? (
        <Alert kind="error">{locations.error}</Alert>
      ) : !locations.data ? (
        <p className="muted">Loading…</p>
      ) : (
        <ReceiptEditor receipt={null} orderId={orderId} locations={locations.data} onSaved={(r) => router.replace(`/purchases/receipts/${r.id}`)} />
      )}
    </>
  );
}
