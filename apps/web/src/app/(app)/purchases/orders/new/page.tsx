// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { NewPurchaseOrder } from "./new-purchase-order";

export default function NewPurchaseOrderPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <NewPurchaseOrder />
    </Suspense>
  );
}
