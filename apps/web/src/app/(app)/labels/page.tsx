// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { LabelsScreen } from "@/components/documents/labels-screen";

export default function LabelsPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <LabelsScreen />
    </Suspense>
  );
}
