// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { Gstr1Report } from "@/components/reports/gst-returns";

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Gstr1Report />
    </Suspense>
  );
}
