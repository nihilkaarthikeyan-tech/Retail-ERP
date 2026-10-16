// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { AccountsReports } from "@/components/accounts/reports-tabs";

export default function AccountsReportsPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <AccountsReports />
    </Suspense>
  );
}
