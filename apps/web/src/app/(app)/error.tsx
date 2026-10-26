// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { CrashScreen } from "@/components/error-screens";

/** A crash inside the system: the menu and top bar stay, only the screen is replaced. */
export default function AppErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrashScreen error={error} reset={reset} inApp />;
}
