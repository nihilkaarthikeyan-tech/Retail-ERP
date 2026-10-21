// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import {
  bandUnitPrice,
  creditNoteDeadline,
  gstDocumentTitle,
  gstinCheckCharacter,
  gstinProblem,
  hsnForPrint,
  gstNumberProblem,
  isCreditNoteLate,
  isValidGstin,
  needsBuyerDetails,
  pickGstRate,
  priceBandProblem,
  ratesInForce,
  resolveSupply,
  shortFinancialYear,
  supplyLineTax,
  taxSituationOf,
  tillInvoicePrefixCandidates,
  tillNumberSeries,
} from './gst-core.js';
import { isStateCode } from './india.js';
import { inclusiveTax } from './pos.js';
import { posBuyerSchema } from './schemas/gst-core.js';

describe('GSTIN check character', () => {
  it('accepts published GSTINs and works out their check character', () => {
    expect(gstinCheckCharacter('27AAPFU0939F1Z')).toBe('V');
    expect(gstinCheckCharacter('27AAACR5055K1Z')).toBe('7');
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin(' 27aapfu0939f1zv ')).toBe(true);
  });
  it('refuses typing mistakes with a plain message', () => {
    expect(gstinProblem('27AAPFU0939F1ZW')).toMatch(/typing mistake/);
    expect(gstinProblem('27AAPFU0939F1Z')).toMatch(/15 letters/);
    expect(gstinProblem('27AAPFU0939F1XV')).toMatch(/not a GSTIN/);
    const bad = `99AAPFU0939F1Z${gstinCheckCharacter('99AAPFU0939F1Z')}`;
    expect(gstinProblem(bad, isStateCode)).toMatch(/not a state code/);
  });
  it('the buyer schema needs a name and address with a GSTIN', () => {
    const g = `29AABCK1234A1Z${gstinCheckCharacter('29AABCK1234A1Z')}`;
    expect(posBuyerSchema.safeParse({ gstin: g, name: 'Kaveri Traders', address: 'Bengaluru' }).success).toBe(true);
    expect(posBuyerSchema.safeParse({ gstin: g }).success).toBe(false);
    expect(posBuyerSchema.safeParse({ gstin: '29AABCK1234A1Z0', name: 'x', address: 'y' }).success).toBe(false);
  });
});

describe('rates by date and price band (G2)', () => {
  const rows = [
    { hsnCode: '6205', rate: '5', priceFrom: null, priceUpTo: '2500', effectiveFrom: '2025-09-22' },
    { hsnCode: '6205', rate: '18', priceFrom: '2500', priceUpTo: null, effectiveFrom: '2025-09-22' },
    { hsnCode: '6205', rate: '12', effectiveFrom: '2025-04-01' },
    { hsnCode: '1006', rate: '5', effectiveFrom: '2025-04-01' },
    { hsnCode: '10063020', rate: '0', kind: 'nil', effectiveFrom: '2025-04-01' },
  ];
  it('chooses the band by the selling price per unit, GST included', () => {
    expect(pickGstRate(rows, '62052000', '2026-10-18', '2000')?.rate).toBe('5');
    expect(pickGstRate(rows, '6205', '2026-10-18', '2500')?.rate).toBe('5');
    expect(pickGstRate(rows, '6205', '2026-10-18', '2500.01')?.rate).toBe('18');
    expect(pickGstRate(rows, '6205', '2026-10-18', '3000')?.rate).toBe('18');
    expect(pickGstRate(rows, '6205', '2026-10-18', '0')?.rate).toBe('5');
    expect(pickGstRate(rows, '6205', '2026-10-18')?.rate).toBe('5');
  });
  it('uses the rate in force on the date; old bills keep theirs', () => {
    expect(pickGstRate(rows, '6205', '2025-09-21', '3000')?.rate).toBe('12');
    expect(ratesInForce(rows, '6205', '2025-09-22')).toHaveLength(2);
    expect(pickGstRate(rows, '6205', '2025-03-31')).toBeNull();
  });
  it('the longest HSN code wins; nil kept as its own kind', () => {
    expect(pickGstRate(rows, '10063020', '2026-01-01')?.kind).toBe('nil');
    expect(pickGstRate(rows, '10061010', '2026-01-01')?.rate).toBe('5');
    expect(pickGstRate(rows, null, '2026-01-01')).toBeNull();
  });
  it('band price per unit from the line amount', () => {
    expect(bandUnitPrice('6000', '2').toString()).toBe('3000');
    expect(bandUnitPrice('-3000', '-1').toString()).toBe('3000');
  });
  it('overlapping bands are refused', () => {
    expect(priceBandProblem(rows.slice(0, 2))).toBeNull();
    expect(priceBandProblem([rows[0], { ...rows[1], priceFrom: '2000' }])).toMatch(/overlap/);
    expect(priceBandProblem([{ hsnCode: '6205', rate: '5', priceFrom: '100', priceUpTo: '50', effectiveFrom: '2025-01-01' }])).toMatch(/more than/);
  });
});

describe('place of supply and tax situation (G1, G3)', () => {
  const regular = { sellerState: '33', scheme: 'regular' };
  it('walk-in: the store state, CGST + SGST', () => {
    expect(resolveSupply(regular)).toEqual({ invoiceKind: 'consumer', situation: 'unregistered', placeOfSupply: '33', interState: false, noTax: false });
  });
  it('a buyer GSTIN of another state: business invoice with IGST', () => {
    expect(resolveSupply({ ...regular, buyerGstin: '29AABCK1234A1Z5' })).toMatchObject({ invoiceKind: 'business', placeOfSupply: '29', interState: true });
    expect(resolveSupply({ ...regular, buyerGstin: '33AABCK1234A1Z5' })).toMatchObject({ invoiceKind: 'business', placeOfSupply: '33', interState: false });
  });
  it('a delivery address in another state: IGST', () => {
    expect(resolveSupply({ ...regular, deliveryState: '32' })).toMatchObject({ invoiceKind: 'consumer', placeOfSupply: '32', interState: true });
    expect(resolveSupply({ ...regular, buyerGstin: '29AABCK1234A1Z5', deliveryState: '33' })).toMatchObject({ placeOfSupply: '33', interState: false });
  });
  it('an unregistered buyer’s state on the bill is the place of supply', () => {
    expect(resolveSupply({ ...regular, buyerState: '29' })).toMatchObject({ placeOfSupply: '29', interState: true });
  });
  it('SEZ is always IGST; exempt pays no tax; composition is a bill of supply', () => {
    expect(resolveSupply({ ...regular, buyerGstin: '33AABCK1234A1Z5', taxSituation: 'sez' })).toMatchObject({ interState: true, situation: 'sez' });
    expect(resolveSupply({ ...regular, taxSituation: 'exempt' })).toMatchObject({ noTax: true });
    expect(resolveSupply({ ...regular, scheme: 'composition', buyerGstin: '29AABCK1234A1Z5' })).toMatchObject({ invoiceKind: 'bill_of_supply', noTax: true });
    expect(resolveSupply({ ...regular, buyerGstin: '29AABCK1234A1Z5', taxSituation: 'unregistered' })).toMatchObject({ invoiceKind: 'consumer', placeOfSupply: '33' });
    expect(taxSituationOf('29AABCK1234A1Z5', null)).toBe('regular');
    expect(taxSituationOf(null, undefined)).toBe('unregistered');
  });
});

describe('tax inside the price (G12) and rounding', () => {
  it('₹1,050 at 5%: taxable ₹1,000.00, CGST ₹25.00, SGST ₹25.00; IGST ₹50.00 between states', () => {
    const same = supplyLineTax('1050', '5', { interState: false, noTax: false });
    expect([same.taxable, same.cgst, same.sgst, same.igst].map((d) => d.toFixed(2))).toEqual(['1000.00', '25.00', '25.00', '0.00']);
    const other = supplyLineTax('1050', '5', { interState: true, noTax: false });
    expect([other.taxable, other.igst].map((d) => d.toFixed(2))).toEqual(['1000.00', '50.00']);
  });
  it('no tax on a bill of supply: the whole amount is the value', () => {
    const t = supplyLineTax('1050', '5', { interState: false, noTax: true });
    expect([t.taxable, t.tax].map((d) => d.toFixed(2))).toEqual(['1050.00', '0.00']);
  });
  it('per line rounding: line taxes add up to the HSN totals exactly', () => {
    const lines = ['99.99', '99.99', '99.99'].map((a) => inclusiveTax(a, '18'));
    for (const l of lines) expect(l.taxable.add(l.cgst).add(l.sgst).toFixed(2)).toBe('99.99');
  });
});

describe('consumer details, credit notes and printing (G5, G6)', () => {
  it('buyer details from ₹50,000 taxable value', () => {
    expect(needsBuyerDetails('49999.99')).toBe(false);
    expect(needsBuyerDetails('50000')).toBe(true);
  });
  it('credit note deadline: 30 November after the sale’s financial year', () => {
    expect(creditNoteDeadline('2026-10-18')).toBe('2027-11-30');
    expect(creditNoteDeadline('2027-03-31')).toBe('2027-11-30');
    expect(creditNoteDeadline('2027-04-01')).toBe('2028-11-30');
    expect(isCreditNoteLate('2026-10-18', '2027-11-30')).toBe(false);
    expect(isCreditNoteLate('2026-10-18', '2027-12-01')).toBe(true);
  });
  it('titles and HSN digits', () => {
    expect(gstDocumentTitle('sale', 'consumer')).toBe('Tax invoice');
    expect(gstDocumentTitle('sale', 'bill_of_supply')).toBe('Bill of supply');
    expect(gstDocumentTitle('return', 'business')).toBe('Credit note');
    expect(hsnForPrint('62052000', 4)).toBe('6205');
    expect(hsnForPrint('62052000', 6)).toBe('620520');
    expect(hsnForPrint('6205', 8)).toBe('6205');
  });
});

describe('GST invoice numbers (rule 46(b))', () => {
  it('till numbers fit in 16 characters', () => {
    expect(shortFinancialYear('2026-27')).toBe('2627');
    expect(shortFinancialYear('2026-2027')).toBe('2627');
    expect(tillNumberSeries('MAT1', '2026-27')).toBe('MAT1/2627/');
    expect(`${tillNumberSeries('MAT1', '2026-27')}000001`).toHaveLength(16);
    expect(gstNumberProblem('MAT1/2627/000001')).toBeNull();
    expect(gstNumberProblem('MAIN-T1-2026-27-000001')).toMatch(/longer than 16/);
    expect(gstNumberProblem('MAT1 2627')).toMatch(/only have letters/);
    expect(tillNumberSeries('MAIN-T1', '2026-27')).toBe('MAIN-T1-2026-27-');
  });
  it('default prefixes from the store and till codes', () => {
    expect(tillInvoicePrefixCandidates('MAIN', 'T1')[0]).toBe('MAT1');
    expect(tillInvoicePrefixCandidates('ANNA', 'T2')[0]).toBe('ANT2');
    expect(tillInvoicePrefixCandidates('MAIN', 'COUNTR').every((p) => p.length <= 4)).toBe(true);
  });
});
