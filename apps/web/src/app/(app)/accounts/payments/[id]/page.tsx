// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { PaymentPage } from "./payment-page";

export default function PaymentRoute({ params }: PageProps<"/accounts/payments/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <PaymentPage params={params} />
    </Suspense>
  );
}
