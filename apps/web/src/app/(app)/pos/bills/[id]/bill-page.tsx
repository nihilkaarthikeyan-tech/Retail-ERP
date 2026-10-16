// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { use } from "react";
import { BillView } from "@/components/pos/bill-view";
import type { PosBillDto } from "@/components/pos/pos-shared";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/use-load";

export function PosBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const bill = useLoad(() => api.get<PosBillDto>(`/pos/bills/${id}`), [id]);

  return (
    <>
      <p>
        <Link href="/pos/bills">← Till bills</Link>
      </p>
      <Alert kind="error">{bill.error}</Alert>
      {bill.data ? <BillView key={bill.data.id} bill={bill.data} onChanged={() => void bill.reload()} /> : bill.loading ? <p className="muted">Loading…</p> : null}
    </>
  );
}
