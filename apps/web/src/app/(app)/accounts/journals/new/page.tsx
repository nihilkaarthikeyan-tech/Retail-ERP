// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { NewJournal } from "./new-journal";

export default function NewJournalPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <NewJournal />
    </Suspense>
  );
}
