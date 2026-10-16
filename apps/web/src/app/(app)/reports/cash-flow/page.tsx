// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { CashFlowReport } from "@/components/reports/money-reports";

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <CashFlowReport />
    </Suspense>
  );
}
