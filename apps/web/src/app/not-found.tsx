// Copyright (c) 2026, Rademics. All rights reserved.
import type { Metadata } from "next";
import { NotFoundScreen } from "@/components/error-screens";

export const metadata: Metadata = { title: "Page not found · Retail ERP" };

export default function NotFound() {
  return <NotFoundScreen />;
}
