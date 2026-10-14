// Copyright (c) 2026, Rademics. All rights reserved.
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
