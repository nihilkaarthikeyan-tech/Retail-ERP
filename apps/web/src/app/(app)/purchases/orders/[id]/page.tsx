// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { PurchaseOrderPage } from "./purchase-order-page";

export default function PurchaseOrderRoute({ params }: PageProps<"/purchases/orders/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <PurchaseOrderPage params={params} />
    </Suspense>
  );
}
