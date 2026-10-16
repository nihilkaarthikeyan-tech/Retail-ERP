// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import dynamic from "next/dynamic";

// The till reads this computer's registration and its own database, which only
// exist in the browser, so it is not rendered on the server.
const TillPage = dynamic(() => import("@/components/till/till-app").then((m) => m.TillPage), {
  ssr: false,
  loading: () => <p className="till-center muted">Opening the till…</p>,
});

export default function Page() {
  return <TillPage />;
}
