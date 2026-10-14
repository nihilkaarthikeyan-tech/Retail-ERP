// Copyright (c) 2026, Rademics. All rights reserved.
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Retail ERP",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
