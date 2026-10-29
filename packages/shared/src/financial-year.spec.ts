// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateInRange,
  daysUntil,
  financialYearName,
  isIsoDate,
  isRegularYear,
  nextFinancialYear,
  rangesOverlap,
} from './financial-year.js';

const fy2627 = { startDate: '2026-04-01', endDate: '2027-03-31' };

describe('financial years', () => {
  it('names an April–March year across two calendar years', () => {
    expect(financialYearName(fy2627)).toBe('2026-27');
  });

  it('names a calendar year with one year only', () => {
    expect(financialYearName({ startDate: '2027-01-01', endDate: '2027-12-31' })).toBe('2027');
  });

  it('recognises a regular twelve-month year', () => {
    expect(isRegularYear(fy2627)).toBe(true);
    expect(isRegularYear({ startDate: '2024-02-29', endDate: '2025-02-28' })).toBe(true);
    expect(isRegularYear({ startDate: '2026-10-14', endDate: '2027-03-31' })).toBe(false);
  });

  it('creates the next year from the previous one', () => {
    expect(nextFinancialYear(fy2627)).toEqual({ startDate: '2027-04-01', endDate: '2028-03-31' });
  });

  it('detects overlapping and touching ranges', () => {
    expect(rangesOverlap(fy2627, { startDate: '2027-01-01', endDate: '2027-12-31' })).toBe(true);
    expect(rangesOverlap(fy2627, { startDate: '2027-03-31', endDate: '2028-03-30' })).toBe(true);
    expect(rangesOverlap(fy2627, { startDate: '2027-04-01', endDate: '2028-03-31' })).toBe(false);
  });

  it('handles days and ranges', () => {
    expect(addDays('2027-03-31', 1)).toBe('2027-04-01');
    expect(daysUntil('2027-03-28', '2027-03-31')).toBe(3);
    expect(dateInRange('2026-04-01', fy2627)).toBe(true);
    expect(dateInRange('2027-04-01', fy2627)).toBe(false);
  });

  it('validates ISO dates strictly', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-4-1')).toBe(false);
  });
});

describe('nextFinancialYear across February (audit 6)', () => {
  it('keeps the 28th or 29th right in leap years, and April to March as before', async () => {
    const { nextFinancialYear: next } = await import('./financial-year.js');
    expect(next({ startDate: '2026-03-01', endDate: '2027-02-28' })).toEqual({ startDate: '2027-03-01', endDate: '2028-02-29' });
    expect(next({ startDate: '2027-03-01', endDate: '2028-02-29' })).toEqual({ startDate: '2028-03-01', endDate: '2029-02-28' });
    expect(next({ startDate: '2026-04-01', endDate: '2027-03-31' })).toEqual({ startDate: '2027-04-01', endDate: '2028-03-31' });
    // After a short first year ending 31 March, a regular year follows.
    expect(next({ startDate: '2026-10-01', endDate: '2027-03-31' })).toEqual({ startDate: '2027-04-01', endDate: '2028-03-31' });
  });
});
