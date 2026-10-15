// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { TillPage } from "./till-page";

export default function TillRoute({ params }: PageProps<"/pos/tills/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <TillPage params={params} />
    </Suspense>
  );
}
