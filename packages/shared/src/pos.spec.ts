// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import {
  bestOffer,
  changeDue,
  deliveryChargeFor,
  checkDiscount,
  denominationTotal,
  effectiveDiscountPercent,
  expectedAtClose,
  freeUnits,
  inclusiveTax,
  lineOfferSaving,
  planOffers,
  type PlanOffer,
  roundBill,
  saleLineAmount,
  shareByWeight,
} from './pos.js';

const t = (r: ReturnType<typeof inclusiveTax>) => [r.taxable.toFixed(2), r.cgst.toFixed(2), r.sgst.toFixed(2), r.igst.toFixed(2)];

describe('GST inside prices that include it', () => {
  it('scenario 6.1: 2 Basmati at ₹120 (5%) and 1 Surf at ₹132 (18%)', () => {
    // Decision L8: CGST and SGST are each worked out and always equal; the taxable value takes the odd paisa.
    expect(t(inclusiveTax('240', '5'))).toEqual(['228.58', '5.71', '5.71', '0.00']);
    expect(t(inclusiveTax('132', '18'))).toEqual(['111.86', '10.07', '10.07', '0.00']);
  });

  it('scenario 6.2: a returned Basmati at ₹120 is minus ₹114.28, CGST ₹2.86, SGST ₹2.86', () => {
    expect(t(inclusiveTax('-120', '5'))).toEqual(['-114.28', '-2.86', '-2.86', '0.00']);
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

describe('offers over the whole bill (plan 11 B3, scenario 11.12)', () => {
  const any3: PlanOffer = { id: 'o1', code: 'ANY3', kind: 'mix_match', setQuantity: 3, setPrice: '999' };
  const cheapest: PlanOffer = { id: 'o2', code: 'B2CF', kind: 'mix_match', setQuantity: 2, cheapestFree: true };
  const belt: PlanOffer = { id: 'o3', code: 'BELT', kind: 'buy_get', buyQuantity: '1', freeQuantity: '1', freeUnitValue: '299' };
  const line = (lineNo: number, quantity: string, price: string, offers: PlanOffer[], countable = true) => ({ lineNo, quantity, price, offers, countable });
  const discounts = (plan: ReturnType<typeof planOffers>) => [...plan.lines.entries()].sort((a, b) => a[0] - b[0]).map(([n, p]) => [n, p.offer.code, p.discount.toFixed(2)]);

  it('any 3 for ₹999: ₹198 spread over three ₹399 lines; a fourth pays full price', () => {
    expect(discounts(planOffers([line(1, '1', '399', [any3]), line(2, '1', '399', [any3]), line(3, '1', '399', [any3])]))).toEqual([
      [1, 'ANY3', '66.00'],
      [2, 'ANY3', '66.00'],
      [3, 'ANY3', '66.00'],
    ]);
    expect(discounts(planOffers([line(1, '4', '399', [any3])]))).toEqual([[1, 'ANY3', '198.00']]);
    // Uneven prices: ₹1,150 for ₹999 saves ₹151, shared by value; the last line takes the remainder.
    expect(discounts(planOffers([line(1, '2', '400', [any3]), line(2, '1', '350', [any3])]))).toEqual([
      [1, 'ANY3', '105.04'],
      [2, 'ANY3', '45.96'],
    ]);
    // Six make two sets.
    expect(discounts(planOffers([line(1, '6', '399', [any3])]))).toEqual([[1, 'ANY3', '396.00']]);
    // Not worth it: three for more than they cost apart.
    expect(planOffers([line(1, '3', '300', [any3])]).lines.size).toBe(0);
  });

  it('buy 2, cheapest free: the ₹499 top is free; sets take the dearest first', () => {
    expect(discounts(planOffers([line(1, '1', '599', [cheapest]), line(2, '1', '499', [cheapest])]))).toEqual([
      [1, 'B2CF', '0.00'],
      [2, 'B2CF', '499.00'],
    ]);
    const four = planOffers([line(1, '1', '299', [cheapest]), line(2, '1', '599', [cheapest]), line(3, '1', '399', [cheapest]), line(4, '1', '499', [cheapest])]);
    expect(discounts(four).filter((d) => d[2] !== '0.00')).toEqual([
      [1, 'B2CF', '299.00'],
      [4, 'B2CF', '499.00'],
    ]);
  });

  it('buy a shirt, get a belt: a free line of the other item', () => {
    const plan = planOffers([line(1, '2', '1299', [belt])]);
    expect(plan.freeItems.map((f) => [f.offer.code, f.quantity.toString(), f.ofLineNo, f.saving.toFixed(2)])).toEqual([['BELT', '2', 1, '598.00']]);
    expect(plan.lines.get(1)?.discount.toFixed(2)).toBe('0.00');
    // Nothing to give when the free item has no price.
    expect(planOffers([line(1, '1', '1299', [{ ...belt, freeUnitValue: null }])]).freeItems).toEqual([]);
  });

  it('the bill gets the offers that save the most; lines with a manual discount do not count', () => {
    const tenPct: PlanOffer = { id: 'o4', code: 'TEN', kind: 'percent', value: '10' };
    const quarter: PlanOffer = { id: 'o5', code: 'QUARTER', kind: 'percent', value: '25' };
    const three = [1, 2, 3].map((n) => line(n, '1', '399', [tenPct, any3]));
    expect(discounts(planOffers(three)).map((d) => d[1])).toEqual(['ANY3', 'ANY3', 'ANY3']);
    const better = [1, 2, 3].map((n) => line(n, '1', '399', [quarter, any3]));
    expect(discounts(planOffers(better))).toEqual([
      [1, 'QUARTER', '99.75'],
      [2, 'QUARTER', '99.75'],
      [3, 'QUARTER', '99.75'],
    ]);
    const manual = [line(1, '1', '399', [any3]), line(2, '1', '399', [any3]), line(3, '1', '399', [any3], false)];
    expect(planOffers(manual).lines.size).toBe(0);
  });
});

describe('home delivery charge (decision 47)', () => {
  it('₹50 below ₹2,000; nothing at or above it, or with no charge set', () => {
    expect(deliveryChargeFor('1500', '50', '2000').toFixed(2)).toBe('50.00');
    expect(deliveryChargeFor('2000', '50', '2000').toFixed(2)).toBe('0.00');
    expect(deliveryChargeFor('2500', '50', null).toFixed(2)).toBe('50.00');
    expect(deliveryChargeFor('100', '0', null).toFixed(2)).toBe('0.00');
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
