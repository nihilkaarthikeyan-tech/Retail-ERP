// Copyright (c) 2026, Rademics. All rights reserved.
import { Suspense } from "react";
import { UserEditor } from "./user-editor";

export default function UserPage({ params }: PageProps<"/users/[id]">) {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <UserEditor params={params} />
    </Suspense>
  );
}
