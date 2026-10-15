// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { ReceiptPage } from "./receipt-page";

export default function ReceiptRoute({ params }: PageProps<"/purchases/receipts/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <ReceiptPage params={params} />
    </Suspense>
  );
}
