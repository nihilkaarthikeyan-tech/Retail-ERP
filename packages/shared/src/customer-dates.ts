// Copyright (c) 2026, Rademics. All rights reserved.
// Customer birthdays and anniversaries (plan 11 C10). Stored as "MM-DD" with
// an optional year, so a date can be kept without knowing the year. All dates
// here are Indian business dates (YYYY-MM-DD strings, rule 15).
import { addDays } from './financial-year.js';

const DAY_MONTH_RE = /^(\d{2})-(\d{2})$/;
/** Days in each month, counting 29 February (it is a real day in leap years). */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const EARLIEST_CUSTOMER_YEAR = 1900;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** A real day and month written "MM-DD", e.g. "08-15"; "02-29" counts. */
export function isDayMonth(value: string): boolean {
  const m = DAY_MONTH_RE.exec(value);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= MONTH_DAYS[month - 1];
}

/**
 * What is wrong with a day-and-month and its optional year, in plain words, or
 * null when it is fine. The year may not be in the future or before 1900, and
 * 29 February needs a leap year.
 */
export function dayMonthYearProblem(dayMonth: string | null | undefined, year: number | null | undefined, today: string): string | null {
  if (!dayMonth) return year != null ? 'Give the day and month as well as the year' : null;
  if (!isDayMonth(dayMonth)) return 'Not a real day and month';
  if (year == null) return null;
  const thisYear = Number(today.slice(0, 4));
  if (!Number.isInteger(year) || year < EARLIEST_CUSTOMER_YEAR || year > thisYear) return `The year must be between ${EARLIEST_CUSTOMER_YEAR} and ${thisYear}`;
  if (dayMonth === '02-29' && !isLeapYear(year)) return `${year} had no 29 February`;
  if (`${year}-${dayMonth}` > today) return 'The date is in the future';
  return null;
}

/**
 * The day in the `days` days starting `from` (inclusive) on which a yearly
 * day-and-month falls, or null. Wraps across the year end. 29 February is
 * kept on 28 February in years without it.
 */
export function occurrenceInWindow(dayMonth: string, from: string, days: number): string | null {
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const year = Number(date.slice(0, 4));
    const wanted = dayMonth === '02-29' && !isLeapYear(year) ? '02-28' : dayMonth;
    if (date.slice(5) === wanted) return date;
  }
  return null;
}

/** Every stored "MM-DD" that falls in the window (for a database filter), including "02-29" when it is kept on 28 February. */
export function dayMonthsInWindow(from: string, days: number): string[] {
  const out = new Set<string>();
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    out.add(date.slice(5));
    if (date.slice(5) === '02-28' && !isLeapYear(Number(date.slice(0, 4)))) out.add('02-29');
  }
  return [...out];
}

/** "15 Aug" for "08-15". */
export function dayMonthLabel(dayMonth: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!isDayMonth(dayMonth)) return dayMonth;
  return `${Number(dayMonth.slice(3))} ${months[Number(dayMonth.slice(0, 2)) - 1]}`;
}
