// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { dayMonthLabel, dayMonthsInWindow, dayMonthYearProblem, isDayMonth, occurrenceInWindow } from './customer-dates.js';

describe('birthday and anniversary dates (plan 11 C10)', () => {
  it('accepts only real days and months', () => {
    expect(isDayMonth('08-15')).toBe(true);
    expect(isDayMonth('02-29')).toBe(true);
    expect(isDayMonth('02-30')).toBe(false);
    expect(isDayMonth('04-31')).toBe(false);
    expect(isDayMonth('13-01')).toBe(false);
    expect(isDayMonth('8-15')).toBe(false);
    expect(isDayMonth('00-10')).toBe(false);
  });

  it('checks the year against the day and month', () => {
    const today = '2026-10-16';
    expect(dayMonthYearProblem(null, null, today)).toBeNull();
    expect(dayMonthYearProblem('05-20', null, today)).toBeNull();
    expect(dayMonthYearProblem('05-20', 1990, today)).toBeNull();
    expect(dayMonthYearProblem(null, 1990, today)).toBe('Give the day and month as well as the year');
    expect(dayMonthYearProblem('02-29', 2023, today)).toBe('2023 had no 29 February');
    expect(dayMonthYearProblem('02-29', 2024, today)).toBeNull();
    expect(dayMonthYearProblem('05-20', 1850, today)).toBe('The year must be between 1900 and 2026');
    expect(dayMonthYearProblem('12-25', 2026, today)).toBe('The date is in the future');
    expect(dayMonthYearProblem('31-12', null, today)).toBe('Not a real day and month');
  });

  it('finds the day in the next 7 days, across the year end', () => {
    expect(occurrenceInWindow('10-18', '2026-10-16', 7)).toBe('2026-10-18');
    expect(occurrenceInWindow('10-16', '2026-10-16', 7)).toBe('2026-10-16');
    expect(occurrenceInWindow('10-23', '2026-10-16', 7)).toBeNull();
    expect(occurrenceInWindow('01-02', '2026-12-29', 7)).toBe('2027-01-02');
    expect(dayMonthsInWindow('2026-12-29', 7)).toEqual(['12-29', '12-30', '12-31', '01-01', '01-02', '01-03', '01-04']);
  });

  it('keeps 29 February on 28 February in other years', () => {
    expect(occurrenceInWindow('02-29', '2027-02-25', 7)).toBe('2027-02-28');
    expect(occurrenceInWindow('02-29', '2028-02-25', 7)).toBe('2028-02-29');
    expect(dayMonthsInWindow('2027-02-27', 2)).toEqual(['02-27', '02-28', '02-29']);
  });

  it('labels a day and month', () => {
    expect(dayMonthLabel('08-15')).toBe('15 Aug');
  });
});
