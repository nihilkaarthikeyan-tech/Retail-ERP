// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { PurchaseReports } from "@/components/purchasing/reports-tabs";

export default function PurchaseReportsPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <PurchaseReports />
    </Suspense>
  );
}
