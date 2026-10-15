// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { NewSupplierBill } from "./new-supplier-bill";

export default function NewSupplierBillPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <NewSupplierBill />
    </Suspense>
  );
}
