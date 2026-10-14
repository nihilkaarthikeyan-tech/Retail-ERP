// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { StoreEditor } from "./store-editor";

export default function StorePage({ params }: PageProps<"/stores/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <StoreEditor params={params} />
    </Suspense>
  );
}
