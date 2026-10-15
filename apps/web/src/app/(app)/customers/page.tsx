// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { CustomersList } from "./customers-list";

export default function CustomersPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <CustomersList />
    </Suspense>
  );
}
