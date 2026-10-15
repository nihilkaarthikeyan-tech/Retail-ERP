// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { dueDates, partDueDate, sharesProblem } from './payment-terms.js';

describe('payment terms due dates (scenario 3.3)', () => {
  const bill = '2027-02-20';

  it('Net 15 = 15 days after the bill date', () => {
    expect(partDueDate(bill, { dueBasis: 'days_after_date', days: 15, months: 0 })).toBe('2027-03-07');
  });

  it('month end + 10 days', () => {
    expect(partDueDate(bill, { dueBasis: 'days_after_month_end', days: 10, months: 0 })).toBe('2027-03-10');
    expect(partDueDate('2024-02-10', { dueBasis: 'days_after_month_end', days: 0, months: 0 })).toBe('2024-02-29');
  });

  it('end of the month N months later', () => {
    expect(partDueDate(bill, { dueBasis: 'months_then_month_end', days: 0, months: 1 })).toBe('2027-03-31');
    expect(partDueDate('2027-01-31', { dueBasis: 'months_then_month_end', days: 0, months: 1 })).toBe('2027-02-28');
    expect(partDueDate('2027-12-15', { dueBasis: 'months_then_month_end', days: 0, months: 2 })).toBe('2028-02-29');
  });

  it('is never before the bill date', () => {
    expect(partDueDate(bill, { dueBasis: 'days_after_date', days: -5, months: 0 })).toBe(bill);
  });

  it('split terms give one date per part and the latest overall', () => {
    const result = dueDates(bill, [
      { share: '50', dueBasis: 'days_after_date', days: 0, months: 0 },
      { share: '50', dueBasis: 'days_after_date', days: 30, months: 0 },
    ]);
    expect(result.parts.map((p) => p.dueDate)).toEqual(['2027-02-20', '2027-03-22']);
    expect(result.dueDate).toBe('2027-03-22');
    expect(dueDates(bill, []).dueDate).toBe(bill);
  });

  it('shares must total 100', () => {
    expect(sharesProblem([{ share: '50' }, { share: '50' }])).toBeNull();
    expect(sharesProblem([{ share: '60' }, { share: '50' }])).toMatch(/110%/);
  });
});
