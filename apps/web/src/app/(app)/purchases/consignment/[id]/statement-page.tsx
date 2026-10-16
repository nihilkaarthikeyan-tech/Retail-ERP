// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { use } from "react";
import { ConsignmentStatementView, useStatement } from "@/components/purchasing/consignment";
import { Alert } from "@/components/ui";

export function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const statement = useStatement(id);

  return (
    <>
      <p>
        <Link href="/purchases/consignment">← Sale or return</Link>
      </p>
      {statement.error ? <Alert kind="error">{statement.error}</Alert> : !statement.data ? <p className="muted">Loading…</p> : <ConsignmentStatementView statement={statement.data} onChanged={statement.setData} />}
    </>
  );
}
