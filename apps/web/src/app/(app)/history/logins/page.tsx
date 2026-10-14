// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { AuditTable } from "@/components/audit-table";

export default function LoginHistoryPage() {
  return (
    <>
      <h1>Login history</h1>
      <p className="muted">Successful logins, failed attempts, lockouts and logouts, with the address they came from.</p>
      <AuditTable path="/audit/logins" withEntity={false} />
    </>
  );
}
