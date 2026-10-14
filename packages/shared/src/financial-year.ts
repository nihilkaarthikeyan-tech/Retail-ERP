// Copyright (c) 2026, Rademics. All rights reserved.
// Pure date rules for financial years (blueprint 02, decision 6).
// Dates are ISO calendar dates ("2026-04-01"); no time zones involved.

export interface DateRange {
  startDate: string;
  endDate: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === value;
}

function toUtc(date: string): Date {
  if (!isIsoDate(date)) throw new Error(`Invalid date ${date}`);
  return new Date(`${date}T00:00:00Z`);
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** Name = start year, or "start-end" when the years differ (e.g. 2026-27). */
export function financialYearName(range: DateRange): string {
  const startYear = toUtc(range.startDate).getUTCFullYear();
  const endYear = toUtc(range.endDate).getUTCFullYear();
  if (startYear === endYear) return String(startYear);
  return `${startYear}-${String(endYear).slice(-2)}`;
}

/** A regular year ends exactly one year minus one day after it starts. */
export function isRegularYear(range: DateRange): boolean {
  const start = toUtc(range.startDate);
  const expectedEnd = new Date(start);
  expectedEnd.setUTCFullYear(expectedEnd.getUTCFullYear() + 1);
  expectedEnd.setUTCDate(expectedEnd.getUTCDate() - 1);
  return fromUtc(expectedEnd) === range.endDate;
}

export function endsAfterStart(range: DateRange): boolean {
  return toUtc(range.endDate) > toUtc(range.startDate);
}

export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return toUtc(a.startDate) <= toUtc(b.endDate) && toUtc(b.startDate) <= toUtc(a.endDate);
}

/** Next year = (old end + 1 day) to (old end + 1 year). */
export function nextFinancialYear(previous: DateRange): DateRange {
  const startDate = addDays(previous.endDate, 1);
  const end = toUtc(previous.endDate);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return { startDate, endDate: fromUtc(end) };
}

export function daysUntil(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

export function dateInRange(date: string, range: DateRange): boolean {
  const d = toUtc(date);
  return d >= toUtc(range.startDate) && d <= toUtc(range.endDate);
}
