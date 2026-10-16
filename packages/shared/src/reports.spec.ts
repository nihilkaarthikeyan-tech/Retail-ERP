// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import {
  averageBill,
  changePercent,
  daysOfStockLeft,
  grossMarginPercent,
  itemsPerBill,
  previousPeriod,
  sellThroughPercent,
  shrinkagePercent,
  stockAge,
  stockAgeLabels,
  stockTurnover,
} from './reports.js';

describe('periods and change', () => {
  it('the previous period has the same length and ends the day before', () => {
    expect(previousPeriod('2026-10-01', '2026-10-15')).toEqual({ from: '2026-09-16', to: '2026-09-30' });
    expect(previousPeriod('2026-10-15', '2026-10-15')).toEqual({ from: '2026-10-14', to: '2026-10-14' });
  });
  it('change % against the previous period; none when it was zero', () => {
    expect(changePercent('1200', '1000')?.toFixed(2)).toBe('20.00');
    expect(changePercent('800', '1000')?.toFixed(2)).toBe('-20.00');
    expect(changePercent('-50', '-100')?.toFixed(2)).toBe('50.00');
    expect(changePercent('500', '0')).toBeNull();
  });
});

describe('sales figures (scenario 9.1)', () => {
  it('average bill and items per bill count sale bills only', () => {
    expect(averageBill('1000', 3).toFixed(2)).toBe('333.33');
    expect(averageBill('-200', 0).toFixed(2)).toBe('0.00');
    expect(itemsPerBill('7', 3).toFixed(2)).toBe('2.33');
  });
  it('gross margin %', () => {
    expect(grossMarginPercent('1000', '750')?.toFixed(2)).toBe('25.00');
    expect(grossMarginPercent('0', '10')).toBeNull();
  });
});

describe('stock figures (scenarios 9.4–9.6)', () => {
  it('60 in stock with 90 sold over 30 days leaves 20 days', () => {
    expect(daysOfStockLeft('60', '90', 30)?.toFixed(1)).toBe('20.0');
    expect(daysOfStockLeft('60', '0', 30)).toBeNull();
  });
  it('100 opening and 50 received with 90 sold is 60% sell-through', () => {
    expect(sellThroughPercent('90', '100', '50')?.toFixed(2)).toBe('60.00');
    expect(sellThroughPercent('5', '0', '0')).toBeNull();
  });
  it('stock turnover', () => {
    expect(stockTurnover('9000', '4000', '2000')?.toFixed(2)).toBe('3.00');
  });
  it('₹450 lost against ₹9,000 sales is 5%', () => {
    expect(shrinkagePercent('450', '9000')?.toFixed(2)).toBe('5.00');
  });
  it('ages stock newest first: 30 on hand from 40 (100 days) and 20 (10 days)', () => {
    const age = stockAge('30', [{ date: '2026-07-07', quantity: '40' }, { date: '2026-10-05', quantity: '20' }], '2026-10-15');
    expect(stockAgeLabels()).toEqual(['0–30', '31–60', '61–90', '91–180', 'Over 180']);
    expect(Object.fromEntries(Object.entries(age).map(([k, v]) => [k, v.toString()]))).toEqual({ '0–30': '20', '31–60': '0', '61–90': '0', '91–180': '10', 'Over 180': '0' });
  });
  it('stock with no receipt on record counts as the oldest', () => {
    const age = stockAge('15', [{ date: '2026-10-10', quantity: '5' }], '2026-10-15');
    expect(age['0–30'].toString()).toBe('5');
    expect(age['Over 180'].toString()).toBe('10');
  });
});

describe('query yes/no', () => {
  it('reads "false" as no (a plain coercion would read any text as yes)', async () => {
    const { reportQuerySchema } = await import('./schemas/reports.js');
    expect(reportQuerySchema.parse({ worst: 'false' }).worst).toBe(false);
    expect(reportQuerySchema.parse({ worst: 'true' }).worst).toBe(true);
    expect(reportQuerySchema.safeParse({ worst: 'maybe' }).success).toBe(false);
  });
});
