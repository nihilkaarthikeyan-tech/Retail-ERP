// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import {
  addMonths,
  drawFromLots,
  earningAmount,
  formatGiftCardNumber,
  giftCardExpiresOn,
  giftCardNumberFrom,
  giftCardProblem,
  isValidGiftCardNumber,
  LOYALTY_DEFAULTS,
  luhnCheckDigit,
  maskGiftCardNumber,
  maxRedeemable,
  moneyBack,
  paymentUse,
  pointsBack,
  pointsExpireOn,
  pointsFor,
  pointsValue,
  redeemProblem,
  returnRatio,
  returnRefundSplit,
  tierFor,
  tiersProblem,
  tierWindowStart,
} from './loyalty.js';

const base = { earnSpend: LOYALTY_DEFAULTS.earnSpend, earnPoints: LOYALTY_DEFAULTS.earnPoints };

describe('earning points (blueprint 04 process 6, plan 13)', () => {
  it('₹2,450 at ₹100 = 1 point earns 24 points; fractions are dropped', () => {
    expect(pointsFor('2450', base)).toBe(24);
    expect(pointsFor('99.99', base)).toBe(0);
    expect(pointsFor('100', base)).toBe(1);
    expect(pointsFor('0', base)).toBe(0);
    expect(pointsFor('-50', base)).toBe(0);
  });

  it('a Gold rate of ₹100 = 2 points is whole points of (amount × 2 ÷ 100)', () => {
    expect(pointsFor('2450', { earnSpend: '100', earnPoints: 2 })).toBe(49);
    expect(pointsFor('2000', { earnSpend: '100', earnPoints: 2 })).toBe(40);
  });

  it('what is paid with points or gift cards does not earn', () => {
    expect(earningAmount({ total: '500', paidWithPoints: '100' }).toFixed(2)).toBe('400.00');
    expect(pointsFor(earningAmount({ total: '500', paidWithPoints: '100' }), base)).toBe(4);
    expect(earningAmount({ total: '600', paidWithGiftCards: '600' }).toFixed(2)).toBe('0.00');
    expect(earningAmount({ total: '100', paidWithPoints: '50', paidWithGiftCards: '80' }).toFixed(2)).toBe('0.00');
  });

  it('points are worth points × value, in paise', () => {
    expect(pointsValue(100, '1').toFixed(2)).toBe('100.00');
    expect(pointsValue(7, '0.25').toFixed(2)).toBe('1.75');
    expect(pointsValue(3, '0.3333').toFixed(2)).toBe('1.00');
  });

  it('points expire 365 days after the bill and cannot be spent on that day', () => {
    expect(pointsExpireOn('2026-10-21', 365)).toBe('2027-10-21');
  });
});

describe('tiers', () => {
  const tiers = [
    { name: 'Silver', spendFrom: '0', earnSpend: '100', earnPoints: 1 },
    { name: 'Gold', spendFrom: '25000', earnSpend: '100', earnPoints: 2 },
  ];

  it('the highest tier reached by the year’s spend', () => {
    expect(tierFor(tiers, '0')?.name).toBe('Silver');
    expect(tierFor(tiers, '24999.99')?.name).toBe('Silver');
    expect(tierFor(tiers, '25000')?.name).toBe('Gold');
    expect(tierFor([], '100000')).toBeNull();
  });

  it('the lowest tier must start at ₹0; names and starting spends are not repeated', () => {
    expect(tiersProblem(tiers)).toBeNull();
    expect(tiersProblem([])).toBeNull();
    expect(tiersProblem([tiers[1]])).toMatch(/must start at ₹0/);
    expect(tiersProblem([...tiers, { ...tiers[1], name: 'gold ' }])).toMatch(/Two tiers are called/);
    expect(tiersProblem([...tiers, { ...tiers[1], name: 'Platinum' }])).toMatch(/Two tiers start at/);
  });

  it('the spend of the last 12 months counts', () => {
    expect(tierWindowStart('2026-10-21')).toBe('2025-10-22');
    expect(tierWindowStart('2027-01-01')).toBe('2026-01-02');
    expect(tierWindowStart('2028-02-29')).toBe('2027-03-01');
  });
});

describe('spending points (blueprint 04 process 7, plan 13)', () => {
  const limits = { available: 150, minRedeem: 100, maxSharePercent: '50', pointValue: '1', billAmount: '500' };

  it('100 of 150 points can pay ₹100 of a ₹500 bill', () => {
    expect(redeemProblem(100, limits)).toBeNull();
    expect(maxRedeemable(limits)).toBe(150);
  });

  it('fewer than the minimum, more than the balance or more than half the bill are refused', () => {
    expect(redeemProblem(90, limits)).toMatch(/At least 100 points/);
    expect(redeemProblem(300, limits)).toMatch(/At most 50% of the bill \(₹250.00\)/);
    expect(redeemProblem(160, limits)).toMatch(/Only 150 points/);
    expect(redeemProblem(1.5, limits)).toMatch(/whole number/);
  });

  it('the most that can be spent; nothing below the minimum', () => {
    expect(maxRedeemable({ ...limits, available: 400 })).toBe(250);
    expect(maxRedeemable({ ...limits, billAmount: '150' })).toBe(0);
    expect(maxRedeemable({ ...limits, available: 99 })).toBe(0);
  });

  it('points come from the earliest-expiring lots, never expired ones', () => {
    const lots = [
      { id: 'b', remaining: 50, expiresOn: '2027-06-01' },
      { id: 'a', remaining: 40, expiresOn: '2027-01-01' },
      { id: 'x', remaining: 500, expiresOn: '2026-10-21' },
      { id: 'c', remaining: 100, expiresOn: '2027-09-01' },
    ];
    expect(drawFromLots(lots, 100, '2026-10-21')).toEqual([
      { id: 'a', take: 40 },
      { id: 'b', take: 50 },
      { id: 'c', take: 10 },
    ]);
    expect(drawFromLots(lots, 191, '2026-10-21')).toBeNull();
  });
});

describe('returns (decision 16)', () => {
  it('half of a ₹500 bill paid with 100 points gives back 50 points and takes back 2 of the 4 earned', () => {
    const ratio = returnRatio({ originalTotal: '500', returnedTotal: '250', allReturned: false });
    expect(ratio.toString()).toBe('0.5');
    expect(pointsBack(100, ratio, 0)).toBe(50);
    expect(pointsBack(4, ratio, 0)).toBe(2);
    const split = returnRefundSplit({ originalTotal: '500', returnedBefore: '0', thisReturn: '250', allReturned: false, points: { spent: 100, restoredBefore: 0 }, pointValue: '1', giftCards: [] });
    expect(split).toMatchObject({ points: 50 });
    expect(split.pointsValue.toFixed(2)).toBe('50.00');
    expect(split.rest.toFixed(2)).toBe('200.00');
  });

  it('returns one after another add up exactly to the whole bill', () => {
    let restored = 0;
    let returned = '0';
    for (const part of ['100', '150', '250']) {
      const s = returnRefundSplit({ originalTotal: '500', returnedBefore: returned, thisReturn: part, allReturned: part === '250', points: { spent: 33, restoredBefore: restored }, pointValue: '1', giftCards: [] });
      restored += s.points;
      returned = (Number(returned) + Number(part)).toString();
    }
    expect(restored).toBe(33);
  });

  it('gift card money goes back on the card in proportion; an expired card is refunded by the till', () => {
    const s = returnRefundSplit({
      originalTotal: '600',
      returnedBefore: '0',
      thisReturn: '300',
      allReturned: false,
      points: null,
      pointValue: '1',
      giftCards: [
        { key: 'A', paid: '600', refundedBefore: '0', usable: true },
        { key: 'B', paid: '0', refundedBefore: '0', usable: true },
      ],
    });
    expect(s.giftCards.map((g) => [g.key, g.amount.toFixed(2)])).toEqual([
      ['A', '300.00'],
      ['B', '0.00'],
    ]);
    expect(s.rest.toFixed(2)).toBe('0.00');
    const expired = returnRefundSplit({ originalTotal: '600', returnedBefore: '0', thisReturn: '300', allReturned: false, points: null, pointValue: '1', giftCards: [{ key: 'A', paid: '600', refundedBefore: '0', usable: false }] });
    expect(expired.giftCards[0].amount.toFixed(2)).toBe('0.00');
    expect(expired.rest.toFixed(2)).toBe('300.00');
  });

  it('the parts never add up to more than the refund', () => {
    const s = returnRefundSplit({ originalTotal: '100', returnedBefore: '0', thisReturn: '10', allReturned: false, points: { spent: 50, restoredBefore: 0 }, pointValue: '1', giftCards: [{ key: 'A', paid: '50', refundedBefore: '0', usable: true }] });
    expect(s.giftCards[0].amount.toFixed(2)).toBe('5.00');
    expect(s.points).toBe(5);
    expect(s.rest.toFixed(2)).toBe('0.00');
    expect(moneyBack('50', '1', '49.99').toFixed(2)).toBe('0.01');
  });
});

describe('gift card numbers', () => {
  it('16 digits with a Luhn check digit; a mistyped digit is caught', () => {
    expect(luhnCheckDigit('7992739871')).toBe(3);
    const n = giftCardNumberFrom('612345678901234');
    expect(n).toHaveLength(16);
    expect(isValidGiftCardNumber(n)).toBe(true);
    expect(isValidGiftCardNumber(formatGiftCardNumber(n))).toBe(true);
    const wrong = `${n.slice(0, 5)}${(Number(n[5]) + 1) % 10}${n.slice(6)}`;
    expect(isValidGiftCardNumber(wrong)).toBe(false);
    expect(isValidGiftCardNumber('123')).toBe(false);
    expect(() => giftCardNumberFrom('012345678901234')).toThrow();
  });

  it('shown in groups of four, and only the last four after the sale', () => {
    expect(formatGiftCardNumber('6123456789012345')).toBe('6123 4567 8901 2345');
    expect(maskGiftCardNumber('6123456789012345')).toBe('**** 2345');
  });

  it('a card lasts 12 months; blocked and expired cards cannot be used', () => {
    expect(giftCardExpiresOn('2026-10-21')).toBe('2027-10-21');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-12-15', 2)).toBe('2028-02-15');
    expect(giftCardProblem({ status: 'active', expiresOn: '2027-10-21' }, '2027-10-20')).toBeNull();
    expect(giftCardProblem({ status: 'active', expiresOn: '2027-10-21' }, '2027-10-21')).toMatch(/expired on 2027-10-21/);
    expect(giftCardProblem({ status: 'blocked', expiresOn: '2027-10-21' }, '2026-11-01')).toMatch(/blocked/);
  });

  it('points and gift card payment methods are told apart by their account', () => {
    expect(paymentUse({ kind: 'other', accountRole: 'loyalty_liability' })).toBe('points');
    expect(paymentUse({ kind: 'other', accountRole: 'gift_card_liability' })).toBe('gift_card');
    expect(paymentUse({ kind: 'other', accountRole: 'other_receipts' })).toBe('other');
    expect(paymentUse({ kind: 'cash' })).toBe('cash');
  });
});
