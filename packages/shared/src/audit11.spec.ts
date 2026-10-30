// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 11 (tests): money, tax and stock branches no earlier test reached.
import { describe, expect, it } from 'vitest';
import { allocateConsignment } from './consignment.js';
import { eWaySourceProblems, type EWaySource } from './gst-portal.js';
import { emptyFigures, figuresEqual, figuresTax } from './gst-returns.js';
import { GIFT_CARD_PAYMENT_ROLE, isSpecialPaymentMethod, LOYALTY_PAYMENT_ROLE } from './loyalty.js';
import { lineOfferSaving, shareByWeight } from './pos.js';
import { gstProblem, shareCharges, unitCostPerBasicUnit } from './purchasing.js';
import { Decimal } from './rounding.js';
import { apply, EMPTY_STATE } from './stock-costing.js';

const s = (xs: Decimal[]) => xs.map((x) => x.toFixed(2));

describe('till offers and sharing', () => {
  it('an offer saves nothing on a return line or below its minimum amount', () => {
    expect(lineOfferSaving({ kind: 'percent', value: 10 }, { quantity: -1, price: 100 }).toFixed(2)).toBe('0.00');
    expect(lineOfferSaving({ kind: 'percent', value: 10, minAmount: 50 }, { quantity: 1, price: 30 }).toFixed(2)).toBe('0.00');
    expect(lineOfferSaving({ kind: 'percent', value: 10, minAmount: 50 }, { quantity: 2, price: 30 }).toFixed(2)).toBe('6.00');
  });

  it('sharing over no lines gives nothing; over zero weights the last line takes it all', () => {
    expect(shareByWeight('10', [])).toEqual([]);
    expect(s(shareByWeight('10', ['0', '0']))).toEqual(['0.00', '10.00']);
    expect(s(shareByWeight('100', ['1', '1', '1']))).toEqual(['33.33', '33.33', '33.34']);
  });
});

describe('stock costing edges', () => {
  it('refuses goods in with no quantity or a negative cost', () => {
    expect(() => apply(EMPTY_STATE, { kind: 'in', quantity: 0, incomingCost: 10 })).toThrow(/above zero/);
    expect(() => apply(EMPTY_STATE, { kind: 'in', quantity: 1, incomingCost: -1 })).toThrow(/negative/);
  });

  it('a count to 5 with no cost known stops; a count to 0 with no cost is worth 0', () => {
    expect(() => apply(EMPTY_STATE, { kind: 'set', targetQuantity: 5 })).toThrow('MISSING_COST');
    const zero = apply(EMPTY_STATE, { kind: 'set', targetQuantity: 0 });
    expect(zero.after.quantity.toString()).toBe('0');
    expect(zero.after.value.toFixed(2)).toBe('0.00');
  });
});

describe('consignment', () => {
  it('two receipts on one line add together; a return for an unknown line is ignored', () => {
    const layers = allocateConsignment([
      { kind: 'receipt', at: 1, lineId: 'L1', supplierId: 'S', rate: 10, accepted: 5 },
      { kind: 'receipt', at: 2, lineId: 'L1', supplierId: 'S', rate: 10, accepted: 3, rejected: 1 },
      { kind: 'supplier_return', at: 3, lineId: 'NOPE', accepted: 2 },
    ]);
    const l1 = layers.get('L1')!;
    expect(l1.received.toString()).toBe('9');
    expect(l1.returned.toString()).toBe('0');
    expect(l1.held.toString()).toBe('9');
    expect(layers.has('NOPE')).toBe(false);
  });
});

describe('purchase GST and costs', () => {
  const line = { taxable: 100, gstRate: 18, cgst: 9, sgst: 9, igst: 0 };
  it('rates above 100 and negative tax are refused', () => {
    expect(gstProblem(line)).toBeNull();
    expect(gstProblem({ ...line, gstRate: 101 })).toMatch(/between 0 and 100/);
    expect(gstProblem({ ...line, cgst: -9 })).toMatch(/cannot be negative/);
  });

  it('a negative unit cost and charges with nothing to share by are refused', () => {
    expect(() => unitCostPerBasicUnit({ taxable: -10, basicQuantity: 1 })).toThrow(/negative/);
    expect(() => shareCharges(50, [{ key: 'a', quantity: 0, value: 0 }], 'quantity')).toThrow(/no quantity/);
    expect(() => shareCharges(50, [{ key: 'a', quantity: 0, value: 0 }], 'value')).toThrow(/no value/);
  });
});

describe('GST return figures', () => {
  it('tax adds every head; figures within half a paisa count as equal', () => {
    const a = { ...emptyFigures(), taxable: new Decimal(100), cgst: new Decimal(9), sgst: new Decimal(9), cess: new Decimal(1) };
    expect(figuresTax(a).toFixed(2)).toBe('19.00');
    expect(figuresEqual(a, { ...a, cgst: new Decimal('9.004') })).toBe(true);
    expect(figuresEqual(a, { ...a, cgst: new Decimal('9.01') })).toBe(false);
  });
});

describe('e-way bill source', () => {
  const addr = { addr1: 'A', place: 'Chennai', pincode: '600001', stateCode: '33', gstin: '33AAAAA0000A1Z5', name: 'Shop' };
  const src: EWaySource = {
    userGstin: addr.gstin,
    subSupplyType: 1,
    docType: 'INV',
    number: 'X/1',
    date: '2026-10-30',
    from: addr,
    to: { ...addr, name: 'Buyer' },
    lines: [{ name: 'Rice', hsn: '1006', quantity: 1, unit: 'KGS', taxable: 100, cgstRate: 2.5, sgstRate: 2.5, igstRate: 0 }],
    totals: { taxable: 100, cgst: 2.5, sgst: 2.5, igst: 0, total: 105 },
    distanceKm: 10,
    vehicleNo: 'TN01AB1234',
  };
  it('names each missing piece', () => {
    expect(eWaySourceProblems(src)).toEqual([]);
    expect(eWaySourceProblems({ ...src, from: { ...addr, pincode: null }, to: { ...src.to, pincode: '', stateCode: '' }, vehicleNo: null, lines: [] })).toEqual([
      'The dispatch PIN code is missing',
      'The delivery PIN code is missing',
      'The delivery state is missing',
      'Give the transporter id or the vehicle number',
      'There are no goods lines',
    ]);
  });
});

describe('points and gift card methods', () => {
  it('are told apart from plain payment methods', () => {
    expect(isSpecialPaymentMethod({ kind: 'other', accountRole: LOYALTY_PAYMENT_ROLE })).toBe(true);
    expect(isSpecialPaymentMethod({ kind: 'other', accountRole: GIFT_CARD_PAYMENT_ROLE })).toBe(true);
    expect(isSpecialPaymentMethod({ kind: 'cash' })).toBe(false);
    expect(isSpecialPaymentMethod({ kind: 'upi', accountRole: null })).toBe(false);
  });
});
