// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import {
  bandUnitPrice,
  creditNoteDeadline,
  gstDocumentTitle,
  saleDocumentKind,
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
import { Decimal } from './rounding.js';
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
  it('chooses the band by the value per unit before GST (decision L7)', () => {
    expect(pickGstRate(rows, '62052000', '2026-10-18', '2000')?.rate).toBe('5');
    expect(pickGstRate(rows, '6205', '2026-10-18', '2500')?.rate).toBe('5');
    expect(pickGstRate(rows, '6205', '2026-10-18', '2500.01')?.rate).toBe('18');
    expect(pickGstRate(rows, '6205', '2026-10-18', '3000')?.rate).toBe('18');
    expect(pickGstRate(rows, '6205', '2026-10-18', '0')?.rate).toBe('5');
    expect(pickGstRate(rows, '6205', '2026-10-18')?.rate).toBe('5');
  });
  it('a till price includes GST: each band is tried with its own rate taken out (decision L7)', () => {
    const till = (p: string) => pickGstRate(rows, '6205', '2026-10-18', p, { gstIncluded: true })?.rate;
    expect(till('2500')).toBe('5'); // 2,380.95 before GST
    expect(till('2625')).toBe('5'); // exactly 2,500 before GST at 5%
    expect(till('2625.01')).toBe('18');
    // ₹2,700: 2,571.43 at 5% is above the band, 2,288.14 at 18% is below the other: the higher rate, never too little tax.
    expect(till('2700')).toBe('18');
    expect(till('2950.01')).toBe('18');
    expect(till('0')).toBe('5');
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
    expect(resolveSupply(regular)).toEqual({ invoiceKind: 'consumer', situation: 'unregistered', placeOfSupply: '33', interState: false, noTax: false, problem: null });
  });
  it('a buyer GSTIN of another state: business invoice with IGST', () => {
    expect(resolveSupply({ ...regular, buyerGstin: '29AABCK1234A1Z5' })).toMatchObject({ invoiceKind: 'business', placeOfSupply: '29', interState: true });
    expect(resolveSupply({ ...regular, buyerGstin: '33AABCK1234A1ZG' })).toMatchObject({ invoiceKind: 'business', placeOfSupply: '33', interState: false });
  });
  it('a delivery address in another state: IGST', () => {
    expect(resolveSupply({ ...regular, deliveryState: '32' })).toMatchObject({ invoiceKind: 'consumer', placeOfSupply: '32', interState: true });
    expect(resolveSupply({ ...regular, buyerGstin: '29AABCK1234A1Z5', deliveryState: '33' })).toMatchObject({ placeOfSupply: '33', interState: false });
  });
  it('audit 4 T1: an unregistered buyer at the counter is taxed by the shop’s state, whatever state is written on the bill (IGST Act s.10(1)(ca) is not yet in force)', () => {
    expect(resolveSupply({ ...regular, buyerState: '29' })).toMatchObject({ placeOfSupply: '33', interState: false });
    // Delivered to that state: the movement ends there (s.10(1)(a)).
    expect(resolveSupply({ ...regular, buyerState: '29', deliveryState: '29' })).toMatchObject({ placeOfSupply: '29', interState: true });
  });
  it('audit 4 T2: delivered to someone else on a registered buyer’s direction: the buyer’s own state (s.10(1)(b))', () => {
    expect(resolveSupply({ ...regular, buyerGstin: '29AABCK1234A1Z5', deliveryState: '33', deliveredToOther: true })).toMatchObject({ placeOfSupply: '29', interState: true });
    expect(resolveSupply({ ...regular, buyerGstin: '33AABCK1234A1ZG', deliveryState: '29', deliveredToOther: true })).toMatchObject({ placeOfSupply: '33', interState: false });
  });
  it('SEZ is always inter-state, with IGST or under LUT without tax (T6); an "exempt buyer" pays tax (T5); composition: a bill of supply, never to another state (T3)', () => {
    expect(resolveSupply({ ...regular, buyerGstin: '33AABCK1234A1ZG', taxSituation: 'sez' })).toMatchObject({ interState: true, situation: 'sez', noTax: false });
    expect(resolveSupply({ ...regular, buyerGstin: '33AABCK1234A1ZG', taxSituation: 'sez', sezUnderLut: true })).toMatchObject({ interState: true, noTax: true });
    expect(resolveSupply({ ...regular, taxSituation: 'exempt' })).toMatchObject({ noTax: false });
    expect(resolveSupply({ ...regular, scheme: 'composition' })).toMatchObject({ invoiceKind: 'bill_of_supply', noTax: true, problem: null });
    expect(resolveSupply({ ...regular, scheme: 'composition', buyerGstin: '29AABCK1234A1Z5' }).problem).toMatch(/cannot sell to another state/);
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
    // Each line: CGST = SGST = 99.99 × 9 / 118 = 7.626… → ₹7.63; taxable = 99.99 − 15.26 = ₹84.73.
    for (const l of lines) expect([l.taxable, l.cgst, l.sgst, l.igst].map((d) => d.toFixed(2))).toEqual(['84.73', '7.63', '7.63', '0.00']);
    // The HSN summary is the sum of the rounded lines: 3 × 84.73, 3 × 7.63, 3 × 7.63, adding back to ₹299.97.
    const sum = (k: 'taxable' | 'cgst' | 'sgst') => lines.reduce((a, l) => a.add(l[k]), new Decimal(0));
    expect([sum('taxable'), sum('cgst'), sum('sgst')].map((d) => d.toFixed(2))).toEqual(['254.19', '22.89', '22.89']);
    expect(sum('taxable').add(sum('cgst')).add(sum('sgst')).toFixed(2)).toBe('299.97');
    // Taxing the ₹299.97 total once would give CGST ₹22.88 (299.97 × 9 / 118 = 22.879…), so the summary must add the lines, not re-tax the total.
    expect(inclusiveTax('299.97', '18').cgst.toFixed(2)).toBe('22.88');
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
    expect(gstDocumentTitle('return', 'consumer', 'return_note')).toBe('Return note');
    expect(gstDocumentTitle('sale', 'consumer', 'invoice_cum_bill_of_supply')).toBe('Invoice-cum-bill of supply');
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

describe('audit 4 T10: what a sale is called (CGST Act s.31(3)(c), rule 46A)', () => {
  it('all exempt: a bill of supply; taxable and exempt to a walk-in: an invoice-cum-bill of supply; to a business buyer: refused', () => {
    expect(saleDocumentKind('consumer', ['5', '18'])).toEqual({ kind: 'tax_invoice', problem: null });
    expect(saleDocumentKind('consumer', ['0', '0'])).toEqual({ kind: 'bill_of_supply', problem: null });
    expect(saleDocumentKind('consumer', ['0', '18'])).toEqual({ kind: 'invoice_cum_bill_of_supply', problem: null });
    expect(saleDocumentKind('business', ['0', '18']).problem).toMatch(/separate bill/);
    expect(saleDocumentKind('bill_of_supply', ['5'])).toEqual({ kind: 'bill_of_supply', problem: null });
  });
});
