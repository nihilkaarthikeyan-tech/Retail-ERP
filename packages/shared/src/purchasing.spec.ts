// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import {
  documentTotals,
  gstProblem,
  isOverAllowance,
  lineAmounts,
  manualSharesProblem,
  maxWithAllowance,
  percentDone,
  reorderSuggestion,
  shareCharges,
  suggestGst,
  unitCostPerBasicUnit,
} from './purchasing.js';

describe('lineAmounts', () => {
  it('scenario 5.1: 200 × ₹95 is ₹19,000.00 taxable', () => {
    const a = lineAmounts({ quantity: '200', rate: '95' });
    expect([a.gross.toFixed(2), a.discount.toFixed(2), a.taxable.toFixed(2)]).toEqual(['19000.00', '0.00', '19000.00']);
  });

  it('takes the percentage and then the fixed discount, rounded to paise', () => {
    const a = lineAmounts({ quantity: '3', rate: '33.335', discountPercent: '2.5', discountAmount: '1' });
    // gross 100.005 → 100.01; discount 2.50025 + 1 = 3.50025 → 3.50; taxable 96.51
    expect([a.gross.toFixed(2), a.discount.toFixed(2), a.taxable.toFixed(2)]).toEqual(['100.01', '3.50', '96.51']);
  });

  it('refuses discounts above the amount or outside 0–100%', () => {
    expect(() => lineAmounts({ quantity: '1', rate: '10', discountAmount: '11' })).toThrow(/more than the line/);
    expect(() => lineAmounts({ quantity: '1', rate: '10', discountPercent: '101' })).toThrow(/between 0 and 100/);
    expect(() => lineAmounts({ quantity: '1', rate: '10', discountAmount: '-1' })).toThrow(/negative/);
  });
});

describe('GST as stated by the supplier', () => {
  it('scenario 5.1: 5% of ₹19,000 splits into ₹475 + ₹475', () => {
    const g = suggestGst('19000', '5', false);
    expect([g.cgst.toFixed(2), g.sgst.toFixed(2), g.igst.toFixed(2)]).toEqual(['475.00', '475.00', '0.00']);
  });

  it('gives the odd paisa to CGST and uses IGST between states', () => {
    const g = suggestGst('606.10', '5', false); // 30.305 → 30.31 total
    expect([g.cgst.toFixed(2), g.sgst.toFixed(2)]).toEqual(['15.16', '15.15']);
    expect(suggestGst('100', '18', true).igst.toFixed(2)).toBe('18.00');
  });

  it('accepts figures within a paisa and refuses wrong ones', () => {
    expect(gstProblem({ taxable: '11400', gstRate: '5', cgst: '285', sgst: '285', igst: '0' })).toBeNull();
    expect(gstProblem({ taxable: '11400', gstRate: '5', cgst: '285.01', sgst: '285', igst: '0' })).toBeNull();
    expect(gstProblem({ taxable: '11400', gstRate: '5', cgst: '290', sgst: '290', igst: '0' })).toMatch(/does not match 5% of 11400.00 \(570.00\)/);
    expect(gstProblem({ taxable: '100', gstRate: '18', cgst: '9', sgst: '0', igst: '9' })).toMatch(/not both/);
    expect(gstProblem({ taxable: '100', gstRate: '18', cgst: '10', sgst: '8', igst: '0' })).toMatch(/equal/);
    expect(gstProblem({ taxable: '100', gstRate: '0', cgst: '0', sgst: '0', igst: '0' })).toBeNull();
  });
});

describe('documentTotals', () => {
  it('scenario 5.3: ₹11,400 + ₹570 = ₹11,970, no rounding needed', () => {
    const t = documentTotals([{ taxable: '11400', cgst: '285', sgst: '285', igst: '0' }]);
    expect([t.taxable.toFixed(2), t.tax.toFixed(2), t.total.toFixed(2), t.roundingAdjustment.toFixed(2)]).toEqual(['11400.00', '570.00', '11970.00', '0.00']);
  });

  it('rounds the total to the rupee: ₹0.50 goes up, ₹0.49 goes down (decision 5)', () => {
    expect(documentTotals([{ taxable: '100.25', cgst: '0.125', sgst: '0.125', igst: '0' }]).total.toFixed(2)).toBe('101.00'); // 100.50
    const down = documentTotals([{ taxable: '100.24', cgst: '0.125', sgst: '0.125', igst: '0' }]); // 100.49
    expect([down.total.toFixed(2), down.roundingAdjustment.toFixed(2)]).toEqual(['100.00', '-0.49']);
  });
});

describe('cost per basic unit', () => {
  it('scenario 5.2: ₹11,400 over 120 received is ₹95.0000', () => {
    expect(unitCostPerBasicUnit({ taxable: '11400', basicQuantity: '120' }).toFixed(4)).toBe('95.0000');
  });

  it('scenario 5.8: 10 paid at ₹100 with 2 free costs ₹83.3333 each (decision 27)', () => {
    expect(unitCostPerBasicUnit({ taxable: '1000', basicQuantity: '12' }).toFixed(4)).toBe('83.3333');
  });

  it('adds extra charges and price differences', () => {
    expect(unitCostPerBasicUnit({ taxable: '9500', extraCharges: '475', basicQuantity: '100' }).toFixed(4)).toBe('99.7500');
    expect(unitCostPerBasicUnit({ taxable: '200', priceDifference: '-10', basicQuantity: '5' }).toFixed(4)).toBe('38.0000');
  });

  it('refuses nothing received', () => {
    expect(() => unitCostPerBasicUnit({ taxable: '10', basicQuantity: '0' })).toThrow(/above zero/);
  });
});

describe('sharing extra charges', () => {
  it('scenario 5.9: ₹600 by value over ₹9,500 and ₹2,500 is ₹475 and ₹125', () => {
    const s = shareCharges('600', [
      { key: 'rice', quantity: '100', value: '9500' },
      { key: 'dal', quantity: '25', value: '2500' },
    ], 'value');
    expect(s.map((x) => [x.key, x.amount.toFixed(2)])).toEqual([['rice', '475.00'], ['dal', '125.00']]);
  });

  it('puts the rounding remainder on the last line so the shares add up exactly', () => {
    const s = shareCharges('100', [
      { key: 'a', quantity: '1', value: '1' },
      { key: 'b', quantity: '1', value: '1' },
      { key: 'c', quantity: '1', value: '1' },
    ], 'quantity');
    expect(s.map((x) => x.amount.toFixed(2))).toEqual(['33.33', '33.33', '33.34']);
  });

  it('checks hand-typed shares within ₹0.02', () => {
    expect(manualSharesProblem('100', ['50', '49.98'])).toBeNull();
    expect(manualSharesProblem('100', ['50', '49.97'])).toMatch(/99.97, not 100.00/);
    expect(manualSharesProblem('100', ['101', '-1'])).toMatch(/negative/);
  });

  it('refuses lines with nothing to share by', () => {
    expect(() => shareCharges('10', [{ key: 'a', quantity: '0', value: '0' }], 'value')).toThrow(/no value/);
  });
});

describe('allowances', () => {
  it('scenario 5.7: with 0% allowance, 201 received against 200 ordered is over; 200 is not', () => {
    expect(isOverAllowance('200', '201', '0')).toBe(true);
    expect(isOverAllowance('200', '200', '0')).toBe(false);
  });

  it('accepts up to the allowance plus 0.01 percent', () => {
    expect(maxWithAllowance('100', '5').toString()).toBe('105');
    expect(isOverAllowance('100', '105', '5')).toBe(false);
    expect(isOverAllowance('100', '105.01', '5')).toBe(false); // 5.01% is within the 0.01 tolerance
    expect(isOverAllowance('100', '105.02', '5')).toBe(true);
  });

  it('never calls a receipt without an order "over"', () => {
    expect(isOverAllowance('0', '50', '0')).toBe(false);
  });
});

describe('progress percentages', () => {
  it('scenario 5.2: 120 of 200 is 60%; extra received on one line does not count past its order', () => {
    expect(percentDone([{ ordered: '200', done: '120' }]).toFixed(2)).toBe('60.00');
    expect(percentDone([{ ordered: '10', done: '15' }, { ordered: '10', done: '0' }]).toFixed(2)).toBe('50.00');
    expect(percentDone([]).toFixed(2)).toBe('0.00');
  });
});

describe('reorder suggestions', () => {
  it('scenario 5.13: level 50, reorder quantity 100, 30 on hand → 100', () => {
    expect(reorderSuggestion({ onHand: '30', onOrder: '0', level: '50', reorderQuantity: '100' })?.toString()).toBe('100');
  });

  it('suggests nothing while on hand + on order reaches the level', () => {
    expect(reorderSuggestion({ onHand: '30', onOrder: '20', level: '50', reorderQuantity: '100' })).toBeNull();
  });

  it('without a reorder quantity, tops up to the level, rounded up to whole packs', () => {
    expect(reorderSuggestion({ onHand: '13', onOrder: '0', level: '50' })?.toString()).toBe('37');
    expect(reorderSuggestion({ onHand: '13', onOrder: '0', level: '50', roundUpTo: '12' })?.toString()).toBe('48');
  });

  it('a negative stock position still suggests (the till may go below zero)', () => {
    expect(reorderSuggestion({ onHand: '-4', onOrder: '0', level: '10' })?.toString()).toBe('14');
  });
});
