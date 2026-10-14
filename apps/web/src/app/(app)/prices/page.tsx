// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { PricesView } from "./prices-view";

export default function PricesPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <PricesView />
    </Suspense>
  );
}
