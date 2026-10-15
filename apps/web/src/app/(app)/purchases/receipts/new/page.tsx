// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { NewReceipt } from "./new-receipt";

export default function NewReceiptPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <NewReceipt />
    </Suspense>
  );
}
