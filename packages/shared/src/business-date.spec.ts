// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { businessDate, endOfBusinessDay, startOfBusinessDay } from './business-date.js';

describe('business dates are Indian calendar dates', () => {
  it('a sale just after midnight India time is dated the new day, though UTC is still the old day', () => {
    // 00:05 IST on 1 April 2027 is 18:35 UTC on 31 March 2027.
    expect(businessDate(new Date('2027-03-31T18:35:00Z'))).toBe('2027-04-01');
  });

  it('just before midnight India time is still the old day', () => {
    expect(businessDate(new Date('2027-03-31T18:29:59Z'))).toBe('2027-03-31');
  });

  it('day boundaries are at 00:00 IST', () => {
    expect(startOfBusinessDay('2027-04-01').toISOString()).toBe('2027-03-31T18:30:00.000Z');
    expect(endOfBusinessDay('2027-04-01').toISOString()).toBe('2027-04-01T18:30:00.000Z');
  });
});
