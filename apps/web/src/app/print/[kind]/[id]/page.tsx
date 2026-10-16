// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { PrintPage } from "./print-page";

export default function PrintRoute({ params }: PageProps<"/print/[kind]/[id]">) {
  return (
    <Suspense fallback={<p className="doc-wait">Getting the document ready…</p>}>
      <PrintPage params={params} />
    </Suspense>
  );
}
