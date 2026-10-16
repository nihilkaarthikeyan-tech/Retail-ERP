// Copyright (c) 2026, Rademics. All rights reserved.
// The till has its own full-screen layout, outside the back-office shell.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TillServiceWorker } from "@/components/till/till-service-worker";

export const metadata: Metadata = {
  title: "Till · Retail ERP",
};

export default function TillLayout({ children }: { children: ReactNode }) {
  return (
    <div className="area-sales till-root">
      <TillServiceWorker />
      {children}
    </div>
  );
}
