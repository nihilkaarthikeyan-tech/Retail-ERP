// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { ageBand, ageBandLabels, combinePosting, creditCheck, daysBetween, naturalBalance, POSTING_TOLERANCE, settleOldestFirst, wrongSideBalance } from './accounting.js';

describe('combinePosting (blueprint 11 process 1)', () => {
  it('combines lines with the same key and nets them to one side', () => {
    const r = combinePosting(
      [
        { key: 'cash', debit: '200' },
        { key: 'cash', credit: '14' },
        { key: 'sales', credit: '177.14' },
        { key: 'gst', credit: '8.86' },
      ],
      POSTING_TOLERANCE.document,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines.map((l) => [l.key, l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([
      ['cash', '186.00', '0.00'],
      ['sales', '0.00', '177.14'],
      ['gst', '0.00', '8.86'],
    ]);
    expect(r.rounding.toFixed(2)).toBe('0.00');
  });

  it('moves a negative amount to the other side and drops lines that net to zero', () => {
    const r = combinePosting([{ key: 'a', debit: '-50' }, { key: 'b', debit: '50' }, { key: 'c', debit: '10' }, { key: 'c', credit: '10' }], '0');
    expect(r.ok && r.lines.map((l) => [l.key, l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([
      ['a', '0.00', '50.00'],
      ['b', '50.00', '0.00'],
    ]);
  });

  it('a difference within the tolerance goes to rounding; a bigger one is refused', () => {
    const small = combinePosting([{ key: 'a', debit: '100.30' }, { key: 'b', credit: '100' }], POSTING_TOLERANCE.document);
    expect(small.ok && small.rounding.toFixed(2)).toBe('-0.30');
    const journal = combinePosting([{ key: 'a', debit: '100.06' }, { key: 'b', credit: '100' }], POSTING_TOLERANCE.journal);
    expect(journal.ok).toBe(false);
    if (!journal.ok) expect(journal.difference.toFixed(2)).toBe('0.06');
  });
});

describe('balances', () => {
  it('shows assets and expenses as debits, the rest as credits', () => {
    expect(naturalBalance('asset', '500', '200').toFixed(2)).toBe('300.00');
    expect(naturalBalance('income', '50', '1000').toFixed(2)).toBe('950.00');
    expect(naturalBalance('liability', '50', '20').toFixed(2)).toBe('-30.00');
  });
  it('flags a must-be-debit account in credit', () => {
    expect(wrongSideBalance('debit', '-0.01')).toBe(true);
    expect(wrongSideBalance('debit', '0')).toBe(false);
    expect(wrongSideBalance('credit', '5')).toBe(true);
    expect(wrongSideBalance(null, '-5')).toBe(false);
  });
});

describe('ageing', () => {
  it('counts days across months and years', () => {
    expect(daysBetween('2026-03-31', '2026-04-01')).toBe(1);
    expect(daysBetween('2026-10-15', '2026-09-15')).toBe(-30);
  });
  it('puts bills in the default bands', () => {
    expect(ageBand('2026-10-20', '2026-10-15')).toBe('Not due');
    expect(ageBand('2026-10-15', '2026-10-15')).toBe('0–30');
    expect(ageBand('2026-09-15', '2026-10-15')).toBe('0–30');
    expect(ageBand('2026-09-14', '2026-10-15')).toBe('31–60');
    expect(ageBand('2026-06-01', '2026-10-15')).toBe('Over 120');
    expect(ageBandLabels()).toEqual(['Not due', '0–30', '31–60', '61–90', '91–120', 'Over 120']);
  });
});

describe('settleOldestFirst (scenario 7.4)', () => {
  it('pays the oldest bill first and leaves the rest as an advance', () => {
    const r = settleOldestFirst('2000', [
      { id: 'b2', open: '800', date: '2026-10-05' },
      { id: 'b1', open: '1071', date: '2026-10-01' },
    ]);
    expect(r.allocations.map((a) => [a.id, a.amount.toFixed(2)])).toEqual([
      ['b1', '1071.00'],
      ['b2', '800.00'],
    ]);
    expect(r.leftOver.toFixed(2)).toBe('129.00');
  });
  it('stops when the money runs out', () => {
    const r = settleOldestFirst('500', [{ id: 'b1', open: '1071', date: '2026-10-01' }, { id: 'b2', open: '800', date: '2026-10-05' }]);
    expect(r.allocations.map((a) => a.amount.toFixed(2))).toEqual(['500.00']);
    expect(r.leftOver.toFixed(2)).toBe('0.00');
  });
});

describe('creditCheck (decision 22, scenario 7.12)', () => {
  const base = { creditLimit: '5000', owed: '4500', overdue: '0', overdueLimit: '0' };
  it('allows a bill within the limit', () => {
    expect(creditCheck({ ...base, thisBill: '400' })).toEqual({ ok: true });
    expect(creditCheck({ ...base, thisBill: '500' })).toEqual({ ok: true });
  });
  it('refuses above the limit, overridable by a manager', () => {
    const v = creditCheck({ ...base, owed: '4900', thisBill: '200' });
    expect(v).toMatchObject({ ok: false, canOverride: true });
  });
  it('a customer without a credit limit is not approved for credit, with no override', () => {
    expect(creditCheck({ ...base, creditLimit: '0', thisBill: '1' })).toMatchObject({ ok: false, canOverride: false });
  });
  it('refuses when more is overdue than allowed', () => {
    expect(creditCheck({ ...base, owed: '100', overdue: '100', thisBill: '10' })).toMatchObject({ ok: false, canOverride: true });
    expect(creditCheck({ ...base, owed: '100', overdue: '100', overdueLimit: '100', thisBill: '10' })).toEqual({ ok: true });
  });
});
