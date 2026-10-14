// Copyright (c) 2026, Rademics. All rights reserved.
// All business dates (bill dates, shift dates, financial years, reports,
// scheduled jobs) are Indian calendar dates (Asia/Kolkata), never the
// server's UTC date (CLAUDE.md, reliability rule 15). India has no daylight
// saving, so the offset is a fixed +05:30.

export const INDIA_TIME_ZONE = 'Asia/Kolkata';
export const INDIA_UTC_OFFSET_MINUTES = 330;

/** The Indian calendar date (YYYY-MM-DD) for an instant; defaults to now. */
export function businessDate(now: Date = new Date()): string {
  return new Date(now.getTime() + INDIA_UTC_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** The instant an Indian calendar date begins (00:00 IST). */
export function startOfBusinessDay(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+05:30`);
}

/** The first instant after an Indian calendar date ends (00:00 IST next day). */
export function endOfBusinessDay(isoDate: string): Date {
  return new Date(startOfBusinessDay(isoDate).getTime() + 86_400_000);
}
