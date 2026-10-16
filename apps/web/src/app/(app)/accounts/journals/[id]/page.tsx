// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { JournalPage } from "./journal-page";

export default function JournalRoute({ params }: PageProps<"/accounts/journals/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <JournalPage params={params} />
    </Suspense>
  );
}
