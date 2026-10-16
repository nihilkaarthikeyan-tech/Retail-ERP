// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { PosReports } from "@/components/pos/pos-reports";

export default function PosReportsPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <PosReports />
    </Suspense>
  );
}
