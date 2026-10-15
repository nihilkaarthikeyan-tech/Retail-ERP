// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { SupplierEditor } from "./supplier-editor";

export default function SupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <SupplierEditor params={params} />
    </Suspense>
  );
}
