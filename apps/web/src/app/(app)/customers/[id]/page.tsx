// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { CustomerEditor } from "./customer-editor";

export default function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <CustomerEditor params={params} />
    </Suspense>
  );
}
