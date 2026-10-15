// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { ChargePage } from "./charge-page";

export default function ChargeRoute({ params }: PageProps<"/purchases/charges/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <ChargePage params={params} />
    </Suspense>
  );
}
