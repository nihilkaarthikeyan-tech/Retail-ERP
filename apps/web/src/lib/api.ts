// Copyright (c) 2026, Rademics. All rights reserved.
import type { HealthStatus } from "shared";

/** Base URL of the API, as seen from the browser. Fixed at build time. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
  // 503 still carries a HealthStatus body explaining what is down.
  if (!res.ok && res.status !== 503) {
    throw new Error(`API returned HTTP ${res.status}`);
  }
  return (await res.json()) as HealthStatus;
}
