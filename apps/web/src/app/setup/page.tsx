// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { SetupWizard } from "@/components/setup/setup-wizard";

/** First-time setup, step by step (plan 12 §3). Available only while no company exists. */
export default function SetupPage() {
  return <SetupWizard />;
}
