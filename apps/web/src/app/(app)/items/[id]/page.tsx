// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { ItemEditor } from "./item-editor";

export default function ItemPage({ params }: PageProps<"/items/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <ItemEditor params={params} />
    </Suspense>
  );
}
