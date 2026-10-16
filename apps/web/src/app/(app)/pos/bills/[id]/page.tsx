// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { PosBillPage } from "./bill-page";

export default function PosBillRoute({ params }: PageProps<"/pos/bills/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <PosBillPage params={params} />
    </Suspense>
  );
}
