// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { StockCoverReport } from "@/components/reports/stock-reports";

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <StockCoverReport />
    </Suspense>
  );
}
