// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { SeasonSellThroughReport } from "@/components/reports/season-reports";

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <SeasonSellThroughReport />
    </Suspense>
  );
}
