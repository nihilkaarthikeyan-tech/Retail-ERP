// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { type PriceCandidate, rateForLine, selectPrice } from './pricing.js';

function price(overrides: Partial<PriceCandidate> & { id: string; price: string }): PriceCandidate {
  return {
    unitId: 'PCS',
    startDate: '2026-04-01',
    endDate: null,
    customerId: null,
    supplierId: null,
    batchId: null,
    packSize: null,
    ...overrides,
  };
}

const base = { unitId: 'PCS', quantity: '1', date: '2026-10-14' };

describe('selectPrice', () => {
  const general = price({ id: 'g', price: '100' });
  const scheduled = price({ id: 's', price: '105', startDate: '2026-11-01' });
  const contract = price({ id: 'c', price: '90', customerId: 'cust-C' });

  it('ignores prices that start in the future and uses them when due', () => {
    expect(selectPrice([general, scheduled], base)?.id).toBe('g');
    expect(selectPrice([general, scheduled], { ...base, date: '2026-11-01' })?.id).toBe('s');
  });

  it('gives a customer their contract price and walk-ins the general price', () => {
    expect(selectPrice([general, scheduled, contract], { ...base, customerId: 'cust-C' })?.id).toBe('c');
    expect(selectPrice([general, scheduled, contract], { ...base, customerId: 'cust-C', date: '2026-11-01' })?.id).toBe('c');
    expect(selectPrice([general, contract], base)?.id).toBe('g');
    expect(selectPrice([general, contract], { ...base, customerId: 'cust-Z' })?.id).toBe('g');
  });

  it('respects end dates', () => {
    const ended = price({ id: 'e', price: '80', startDate: '2026-04-01', endDate: '2026-09-30' });
    expect(selectPrice([ended], base)).toBeNull();
    expect(selectPrice([ended], { ...base, date: '2026-09-30' })?.id).toBe('e');
  });

  it('prefers a batch price when the line carries that batch', () => {
    const clearance = price({ id: 'b', price: '60', batchId: 'batch-1' });
    expect(selectPrice([general, clearance], { ...base, batchId: 'batch-1' })?.id).toBe('b');
    expect(selectPrice([general, clearance], base)?.id).toBe('g');
  });

  it('prefers the price for the line unit, but will give another unit price for conversion', () => {
    const box = price({ id: 'box', price: '1300', unitId: 'BOX' });
    expect(selectPrice([general, box], { ...base, unitId: 'BOX' })?.id).toBe('box');
    expect(selectPrice([general, box], base)?.id).toBe('g');
    expect(selectPrice([box], base)?.id).toBe('box');
  });

  it('applies a pack-size price only to multiples of the pack', () => {
    const pack = price({ id: 'p', price: '95', packSize: '6' });
    expect(selectPrice([general, pack], { ...base, quantity: '12' })?.id).toBe('p');
    expect(selectPrice([general, pack], { ...base, quantity: '7' })?.id).toBe('g');
  });

  it('a supplier price only applies to that supplier', () => {
    const sup = price({ id: 'sup', price: '70', supplierId: 'sup-1' });
    expect(selectPrice([sup], { ...base, supplierId: 'sup-1' })?.id).toBe('sup');
    expect(selectPrice([sup], base)).toBeNull();
  });
});

describe('rateForLine', () => {
  it('scales a per-basic-unit price to the line unit', () => {
    expect(rateForLine({ price: '110', unitId: 'PCS' }, { unitId: 'BOX', unitFactor: '12' }, '1', false).toString()).toBe('1320');
  });

  it('uses the price as stored when the list is per unit', () => {
    expect(rateForLine({ price: '110', unitId: 'PCS' }, { unitId: 'BOX', unitFactor: '12' }, '1', true).toString()).toBe('110');
  });

  it('returns the price itself for the same unit, rounded to paise', () => {
    expect(rateForLine({ price: '33.333', unitId: 'PCS' }, { unitId: 'PCS', unitFactor: '1' }, '1', false).toString()).toBe('33.33');
  });

  it('converts a box price back to pieces', () => {
    expect(rateForLine({ price: '1320', unitId: 'BOX' }, { unitId: 'PCS', unitFactor: '1' }, '12', false).toString()).toBe('110');
  });
});
