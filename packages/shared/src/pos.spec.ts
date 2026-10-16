// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import {
  bestOffer,
  changeDue,
  checkDiscount,
  denominationTotal,
  effectiveDiscountPercent,
  expectedAtClose,
  freeUnits,
  inclusiveTax,
  lineOfferSaving,
  roundBill,
  saleLineAmount,
  shareByWeight,
} from './pos.js';

const t = (r: ReturnType<typeof inclusiveTax>) => [r.taxable.toFixed(2), r.cgst.toFixed(2), r.sgst.toFixed(2), r.igst.toFixed(2)];

describe('GST inside prices that include it', () => {
  it('scenario 6.1: 2 Basmati at ₹120 (5%) and 1 Surf at ₹132 (18%)', () => {
    expect(t(inclusiveTax('240', '5'))).toEqual(['228.57', '5.72', '5.71', '0.00']);
    expect(t(inclusiveTax('132', '18'))).toEqual(['111.86', '10.07', '10.07', '0.00']);
  });

  it('scenario 6.2: a returned Basmati is minus ₹114.29, CGST ₹2.86, SGST ₹2.85', () => {
    expect(t(inclusiveTax('-120', '5'))).toEqual(['-114.29', '-2.86', '-2.85', '0.00']);
  });

  it('IGST alone between states; 0% means no tax', () => {
    expect(t(inclusiveTax('118', '18', true))).toEqual(['100.00', '0.00', '0.00', '18.00']);
    expect(t(inclusiveTax('56', '0'))).toEqual(['56.00', '0.00', '0.00', '0.00']);
  });

  it('taxable + GST always equals the amount', () => {
    for (const [a, r] of [['99.99', '12'], ['0.01', '28'], ['1234.57', '5'], ['7', '3']]) {
      const x = inclusiveTax(a, r);
      expect(x.taxable.add(x.cgst).add(x.sgst).toFixed(2)).toBe(Number(a).toFixed(2));
    }
  });
});

describe('sale line amounts and discount limits', () => {
  it('quantity × price − percentage − fixed, to paise', () => {
    const l = saleLineAmount({ quantity: '3', price: '33.33', discountPercent: '5', discountAmount: '1' });
    expect([l.gross.toFixed(2), l.discount.toFixed(2), l.amount.toFixed(2)]).toEqual(['99.99', '6.00', '93.99']);
    const r = saleLineAmount({ quantity: '-1', price: '120' });
    expect(r.amount.toFixed(2)).toBe('-120.00');
  });

  it('scenario 6.8: 5% fine, 12% needs a manager, above the item maximum or MRP refused', () => {
    const base = { listPrice: '100', price: '100', mrp: '100', itemMaxPercent: '15', cashierLimitPercent: '5', approved: false };
    expect(checkDiscount({ ...base, manualDiscountPercent: '5' })).toEqual({ ok: true });
    expect(checkDiscount({ ...base, manualDiscountPercent: '12' })).toMatchObject({ ok: false, needsApproval: true });
    expect(checkDiscount({ ...base, manualDiscountPercent: '12', approved: true })).toEqual({ ok: true });
    expect(checkDiscount({ ...base, manualDiscountPercent: '20', approved: true })).toMatchObject({ ok: false, needsApproval: false, reason: expect.stringMatching(/maximum of 15.00%/) });
    expect(checkDiscount({ ...base, price: '101', manualDiscountPercent: '0', approved: true })).toMatchObject({ ok: false, reason: expect.stringMatching(/above the MRP 100.00/) });
  });

  it('works out the effective discount against the list price', () => {
    expect(effectiveDiscountPercent('120', '2', '216').toFixed(2)).toBe('10.00');
  });
});

describe('offers (decision 17)', () => {
  it('buy 2 get 1 free gives whole blocks only', () => {
    expect(freeUnits('5', '2', '1').toString()).toBe('2');
    expect(freeUnits('1', '2', '1').toString()).toBe('0');
  });

  it('scenario 6.9: the biggest saving wins, never a refusal', () => {
    const line = { quantity: '4', price: '30' };
    const b2g1 = { code: 'B2G1', saving: lineOfferSaving({ kind: 'free_goods', buyQuantity: '2', freeQuantity: '1' }, line) };
    const tenPct = { code: 'TEN', saving: lineOfferSaving({ kind: 'percent', value: '10' }, line) };
    expect([b2g1.saving.toFixed(2), tenPct.saving.toFixed(2)]).toEqual(['60.00', '12.00']);
    expect(bestOffer([tenPct, b2g1])?.code).toBe('B2G1');
    expect(bestOffer([{ code: 'A', saving: '5', priority: 1 }, { code: 'B', saving: '5', priority: 3 }])?.code).toBe('B');
    expect(bestOffer([])).toBeNull();
  });

  it('special price, fixed amount and minimums', () => {
    expect(lineOfferSaving({ kind: 'special_price', value: '25' }, { quantity: '2', price: '30' }).toFixed(2)).toBe('10.00');
    expect(lineOfferSaving({ kind: 'special_price', value: '35' }, { quantity: '2', price: '30' }).toFixed(2)).toBe('0.00');
    expect(lineOfferSaving({ kind: 'amount', value: '50' }, { quantity: '1', price: '30' }).toFixed(2)).toBe('30.00');
    expect(lineOfferSaving({ kind: 'percent', value: '10', minQuantity: '3' }, { quantity: '2', price: '30' }).toFixed(2)).toBe('0.00');
  });

  it('a bill discount is shared by amount; the last line takes the remainder', () => {
    expect(shareByWeight('10', ['100', '100', '100']).map((x) => x.toFixed(2))).toEqual(['3.33', '3.33', '3.34']);
  });
});

describe('rounding, change and the cash count', () => {
  it('rounds the bill to the rupee: 0.50 up, 0.49 down', () => {
    expect(roundBill('371.50').rounded.toFixed(2)).toBe('372.00');
    const r = roundBill('371.49');
    expect([r.rounded.toFixed(2), r.adjustment.toFixed(2)]).toEqual(['371.00', '-0.49']);
  });

  it('scenario 6.1: ₹500 cash for ₹372 gives ₹128 change; card cannot overpay', () => {
    expect(changeDue({ total: '372', payments: [{ amount: '500', isCash: true }] }).change.toFixed(2)).toBe('128.00');
    expect(changeDue({ total: '372', payments: [{ amount: '400', isCash: false }] }).overpaidWithoutCash).toBe(true);
    expect(changeDue({ total: '372', payments: [{ amount: '300', isCash: true }] }).short.toFixed(2)).toBe('72.00');
  });

  it('scenario 6.5: expected ₹2,070, counted ₹2,068', () => {
    const expected = expectedAtClose({ opening: '2000', payments: ['500', '-120', '18'], change: '128', cashOut: '200' });
    expect(expected.toFixed(2)).toBe('2070.00');
    const counted = denominationTotal({ '500': 4, '20': 3, '5': 1, '2': 1, '1': 1 });
    expect(counted.toFixed(2)).toBe('2068.00');
    expect(() => denominationTotal({ '10': '1.5' })).toThrow(/whole number/);
  });
});
