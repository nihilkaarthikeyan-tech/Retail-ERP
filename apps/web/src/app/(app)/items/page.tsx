// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { ItemsList } from "./items-list";

export default function ItemsPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <ItemsList />
    </Suspense>
  );
}
