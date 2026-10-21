// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import { documentKey, matchInward, matchSummary, parseGstr2b, periodRange, portalDate, portalPeriod, purchaseTaxSplit } from './gst-inward.js';

describe('purchaseTaxSplit (plan 08 G7, G8)', () => {
  const line = { cgst: '900', sgst: '900', igst: '0', creditClaimable: true };

  it('claimable tax is input credit and owed to the supplier', () => {
    const s = purchaseTaxSplit(line, { reverseCharge: false, composition: false });
    expect(s.input.cgst.toFixed(2)).toBe('900.00');
    expect(s.toCost.toFixed(2)).toBe('0.00');
    expect(s.owedToSupplier.toFixed(2)).toBe('1800.00');
    expect(s.reverseCharge.cgst.toFixed(2)).toBe('0.00');
  });

  it('reverse charge: payable by the shop, claimed as input, nothing to the supplier', () => {
    const s = purchaseTaxSplit(line, { reverseCharge: true, composition: false });
    expect(s.reverseCharge.sgst.toFixed(2)).toBe('900.00');
    expect(s.input.sgst.toFixed(2)).toBe('900.00');
    expect(s.owedToSupplier.toFixed(2)).toBe('0.00');
  });

  it('blocked credit and composition put the tax into the cost', () => {
    expect(purchaseTaxSplit({ ...line, creditClaimable: false }, { reverseCharge: false, composition: false }).toCost.toFixed(2)).toBe('1800.00');
    const c = purchaseTaxSplit(line, { reverseCharge: true, composition: true });
    expect(c.toCost.toFixed(2)).toBe('1800.00');
    expect(c.input.cgst.toFixed(2)).toBe('0.00');
    expect(c.reverseCharge.cgst.toFixed(2)).toBe('900.00');
  });
});

describe('periods and portal formats', () => {
  it('months and financial-year quarters', () => {
    expect(periodRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('2026-Q1')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(periodRange('2026-Q4')).toEqual({ from: '2027-01-01', to: '2027-03-31' });
    expect(periodRange('2026-13')).toBeNull();
  });

  it('reads portal dates and return periods', () => {
    expect(portalDate('05-09-2026')).toBe('2026-09-05');
    expect(portalDate('2026-09-05')).toBe('2026-09-05');
    expect(portalDate('5/9/26')).toBeNull();
    expect(portalPeriod('092026')).toBe('2026-09');
    expect(portalPeriod('132026')).toBeNull();
  });

  it('document numbers ignore case, punctuation and zero padding', () => {
    expect(documentKey('33AAA', 'invoice', 'SGT/001')).toBe(documentKey('33aaa', 'invoice', 'sgt-1'));
    expect(documentKey('33AAA', 'invoice', 'INV 2026/0010')).toBe(documentKey('33AAA', 'invoice', 'inv-2026-10'));
    expect(documentKey('33AAA', 'invoice', 'A10')).not.toBe(documentKey('33AAA', 'invoice', 'A1'));
    expect(documentKey('33AAA', 'invoice', 'A1')).not.toBe(documentKey('33AAA', 'note', 'A1'));
  });
});

describe('parseGstr2b', () => {
  const file = {
    data: {
      gstin: '33AAACR1234A1ZV',
      rtnprd: '092026',
      docdata: {
        b2b: [{ ctin: '33aahcs1234j1zx', trdnm: 'Sri Ganesh', inv: [{ inum: 'SGT/1', dt: '10-09-2026', val: 2100, pos: '33', rev: 'N', itcavl: 'Y', txval: 2000, cgst: 50, sgst: 50, igst: 0, cess: 0 }] }],
        cdnr: [{ ctin: '29AAACM5678C1ZK', nt: [{ ntnum: 'CN-4', typ: 'C', dt: '12-09-2026', val: 105, rev: 'Y', itcavl: 'Y', txval: 100, igst: 5 }] }],
      },
    },
  };

  it('reads invoices and credit notes', () => {
    const s = parseGstr2b(file);
    expect(s).toMatchObject({ gstin: '33AAACR1234A1ZV', period: '2026-09' });
    expect(s.documents).toHaveLength(2);
    expect(s.documents[0]).toMatchObject({ section: 'b2b', kind: 'invoice', supplierGstin: '33AAHCS1234J1ZX', number: 'SGT/1', date: '2026-09-10', reverseCharge: false, itcAvailable: 'Y' });
    expect(s.documents[0].taxable.toFixed(2)).toBe('2000.00');
    expect(s.documents[1]).toMatchObject({ section: 'cdnr', kind: 'credit_note', number: 'CN-4', reverseCharge: true });
    expect(s.documents[1].igst.toFixed(2)).toBe('5.00');
  });

  it('accepts the inner data object too; refuses other files', () => {
    expect(parseGstr2b(file.data).documents).toHaveLength(2);
    expect(() => parseGstr2b({ hello: 1 })).toThrow(/not a GSTR-2B/);
    expect(() => parseGstr2b(null)).toThrow(/not a GSTR-2B/);
  });

  it('matches a supplier credit note with our debit note (minus amounts in our books)', () => {
    const s = parseGstr2b(file);
    const rows = matchInward(s.documents, [
      { id: 'b1', ourNumber: 'PB-1', supplierGstin: '33AAHCS1234J1ZX', supplierName: 'Sri Ganesh', kind: 'invoice', number: 'sgt-001', date: '2026-09-10', taxable: '2000.40', igst: '0', cgst: '50', sgst: '50', reverseCharge: false, inPeriod: true },
      { id: 'd1', ourNumber: 'DN-1', supplierGstin: '29AAACM5678C1ZK', supplierName: 'Mysore', kind: 'note', number: 'CN/4', date: '2026-09-12', taxable: '-100', igst: '-5', cgst: '0', sgst: '0', reverseCharge: false, inPeriod: true },
      { id: 'b2', ourNumber: 'PB-2', supplierGstin: '33AAHCS1234J1ZX', supplierName: 'Sri Ganesh', kind: 'invoice', number: 'SGT/7', date: '2026-08-01', taxable: '10', igst: '0', cgst: '0', sgst: '0', reverseCharge: false, inPeriod: false },
    ]);
    // Within the ₹1 tolerance → matched; the note differs only in the reverse-charge flag; last month's bill is not "only in books".
    expect(rows.map((r) => [r.number, r.status])).toEqual([
      ['SGT/1', 'matched'],
      ['CN-4', 'value_difference'],
    ]);
    expect(rows[1].differences).toEqual(['Reverse charge: portal yes, books no']);
    expect(matchSummary(rows)).toEqual({ matched: 1, value_difference: 1, only_portal: 0, only_books: 0 });
  });
});
