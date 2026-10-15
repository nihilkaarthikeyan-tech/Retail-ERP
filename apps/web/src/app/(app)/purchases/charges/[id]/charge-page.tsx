// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { use } from "react";
import { ChargesView } from "@/components/purchasing/charges-view";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import type { LandedChargeDto } from "@/lib/purchasing";
import { useLoad } from "@/lib/use-load";

export function ChargePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const charge = useLoad(() => api.get<LandedChargeDto>(`/purchase/charges/${id}`), [id]);

  return (
    <>
      <p>
        <Link href="/purchases/charges">← Freight and charges</Link>
      </p>
      {charge.error ? <Alert kind="error">{charge.error}</Alert> : !charge.data ? <p className="muted">Loading…</p> : <ChargesView charge={charge.data} onChanged={charge.setData} />}
    </>
  );
}
