// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { StatementPage } from "./statement-page";

export default function StatementRoute({ params }: PageProps<"/purchases/consignment/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <StatementPage params={params} />
    </Suspense>
  );
}
