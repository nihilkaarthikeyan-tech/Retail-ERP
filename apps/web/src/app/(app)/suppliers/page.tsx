// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { SuppliersList } from "./suppliers-list";

export default function SuppliersPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <SuppliersList />
    </Suspense>
  );
}
