// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { NewStockDocument } from "./new-stock-document";

export default function NewStockDocumentPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <NewStockDocument />
    </Suspense>
  );
}
