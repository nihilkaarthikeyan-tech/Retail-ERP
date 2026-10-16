// Copyright (c) 2026, Rademics. All rights reserved.
// Printed documents have their own plain page, outside the menu and top bar.
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Print · Retail ERP",
};

export default function PrintLayout({ children }: { children: ReactNode }) {
  return <div className="doc-print">{children}</div>;
}
