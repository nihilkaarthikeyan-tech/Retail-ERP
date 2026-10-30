// Copyright (c) 2026, Rademics. All rights reserved.
// Audit 14 (code health): rules the till and the server both use, now written once.
import { describe, expect, it } from 'vitest';
import { returnSupplyOf } from './gst-core.js';

describe('the GST of a return against a bill (returnSupplyOf)', () => {
  const sale = { invoiceKind: 'consumer', cgst: '2.50', sgst: '2.50', igst: '0.00', placeOfSupply: '33', businessDate: '2026-06-10' };

  it("keeps the sale's CGST and SGST within the time limit", () => {
    expect(returnSupplyOf(sale, '33', '2026-10-30')).toEqual({ interState: false, noTax: false, late: false });
  });

  it('after 30 November of the next year: refunded without reducing GST (CGST Act s.34(2))', () => {
    // Sold in 2025-26 (10 March 2026): the last day is 30 November 2026.
    const old = { ...sale, businessDate: '2026-03-10' };
    expect(returnSupplyOf(old, '33', '2026-11-30')).toMatchObject({ noTax: false, late: false });
    expect(returnSupplyOf(old, '33', '2026-12-01')).toMatchObject({ noTax: true, late: true });
  });

  it('IGST when the sale was to another state or to an SEZ; none on a bill of supply or a bill with no tax', () => {
    expect(returnSupplyOf({ ...sale, cgst: '0', sgst: '0', igst: '5.00', placeOfSupply: '29' }, '33', '2026-10-30')).toMatchObject({ interState: true, noTax: false });
    expect(returnSupplyOf({ ...sale, cgst: '0', sgst: '0', igst: '5.00', buyerSituation: 'sez' }, '33', '2026-10-30')).toMatchObject({ interState: true, noTax: false });
    expect(returnSupplyOf({ ...sale, invoiceKind: 'bill_of_supply', cgst: '0', sgst: '0' }, '33', '2026-10-30')).toMatchObject({ noTax: true });
    expect(returnSupplyOf({ ...sale, cgst: '0', sgst: '0' }, '33', '2026-10-30')).toMatchObject({ noTax: true });
  });
});
