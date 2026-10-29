// Copyright (c) 2026, Rademics. All rights reserved.
// Display helpers. Everything here runs in the browser after data has loaded.

import { businessDate } from "shared";

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    // Audit 6: Indian time whatever the computer's own time zone.
    timeZone: "Asia/Kolkata",
  });
}

/** ISO calendar date (YYYY-MM-DD) shown as 01 Apr 2026. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fullName(user: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!user) return "—";
  return [user.firstName, user.lastName].filter((p) => p && p.trim()).join(" ") || "—";
}

/** Today's business date in ISO form (YYYY-MM-DD), on the Indian calendar whatever the browser's time zone. */
export function todayIso(now: Date = new Date()): string {
  return businessDate(now);
}

/** The Indian financial year (1 April to 31 March) containing the Indian business date of the given instant. */
export function financialYearFor(now: Date = new Date()): { startDate: string; endDate: string } {
  const [year, month] = businessDate(now).split("-").map(Number);
  const startYear = month >= 4 ? year : year - 1;
  return { startDate: `${startYear}-04-01`, endDate: `${startYear + 1}-03-31` };
}

/** Empty or whitespace-only text becomes null, so optional fields are sent as "not given". */
export function blankToNull(value: string): string | null {
  const t = value.trim();
  return t === "" ? null : t;
}

/** Like blankToNull but omits the field entirely (for schema fields that are optional, not nullable). */
export function blankToUndefined(value: string): string | undefined {
  const t = value.trim();
  return t === "" ? undefined : t;
}
