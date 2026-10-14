// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { AuditTable } from "@/components/audit-table";

export default function HistoryPage() {
  return (
    <>
      <h1>Change history</h1>
      <p className="muted">Who changed what, with the old and new values. Entries can never be edited or removed.</p>
      <AuditTable path="/audit" withEntity />
    </>
  );
}
