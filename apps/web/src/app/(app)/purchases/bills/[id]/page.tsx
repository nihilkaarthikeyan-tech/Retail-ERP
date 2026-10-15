// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { SupplierBillPage } from "./supplier-bill-page";

export default function SupplierBillRoute({ params }: PageProps<"/purchases/bills/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <SupplierBillPage params={params} />
    </Suspense>
  );
}
