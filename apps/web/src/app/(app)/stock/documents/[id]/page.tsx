// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { StockDocumentPage } from "./stock-document-page";

export default function StockDocumentRoute({ params }: PageProps<"/stock/documents/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <StockDocumentPage params={params} />
    </Suspense>
  );
}
