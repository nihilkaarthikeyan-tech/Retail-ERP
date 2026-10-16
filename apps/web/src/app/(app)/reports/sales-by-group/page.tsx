// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { SalesByGroupReport } from "@/components/reports/sales-reports";

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <SalesByGroupReport />
    </Suspense>
  );
}
