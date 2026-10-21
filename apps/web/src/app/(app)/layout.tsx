// Copyright (c) 2026, Rademics. All rights reserved.
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ModulesProvider } from "@/lib/modules";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ModulesProvider>
      <AppShell>{children}</AppShell>
    </ModulesProvider>
  );
}
