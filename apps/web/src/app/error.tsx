// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { CrashScreen } from "@/components/error-screens";

/** A crash on a public page (landing, login, sign-up). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrashScreen error={error} reset={reset} />;
}
