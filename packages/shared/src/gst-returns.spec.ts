// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import {
  documentSeries,
  gstPositions,
  gstr1PortalJson,
  gstReturnPeriod,
  hsnForReturn,
  invoiceNumberProblem,
  largeConsumerLimit,
  nilSupplyType,
  noteSection,
  outwardSection,
  previousReturnPeriod,
  returnPeriodOf,
  returnPeriodsBetween,
  setOffCredit,
  splitDocumentNumber,
  sumFiguresBy,
  returnDate,
} from './gst-returns.js';
import { stringifyPortalJson, uqcFor } from './gst-portal.js';

const s = (h: { igst: { toFixed: (n: number) => string }; cgst: { toFixed: (n: number) => string }; sgst: { toFixed: (n: number) => string } }) => ({ igst: h.igst.toFixed(2), cgst: h.cgst.toFixed(2), sgst: h.sgst.toFixed(2) });

describe('return periods', () => {
  it('a month and a quarter of the financial year, with the portal period', () => {
    expect(gstReturnPeriod('2026-09')).toMatchObject({ kind: 'month', from: '2026-09-01', to: '2026-09-30', fp: '092026' });
    expect(gstReturnPeriod('2028-02')).toMatchObject({ to: '2028-02-29', fp: '022028' });
    expect(gstReturnPeriod('2026-Q2')).toMatchObject({ kind: 'quarter', from: '2026-07-01', to: '2026-09-30', fp: '092026' });
    expect(gstReturnPeriod('2026-Q4')).toMatchObject({ from: '2027-01-01', to: '2027-03-31', fp: '032027' });
    expect(gstReturnPeriod('2026-13')).toBeNull();
  });
  it('the period of a date by filing frequency, and the one before', () => {
    expect(returnPeriodOf('2026-10-18', 'monthly')).toBe('2026-10');
    expect(returnPeriodOf('2026-10-18', 'quarterly')).toBe('2026-Q3');
    expect(returnPeriodOf('2027-02-01', 'quarterly')).toBe('2026-Q4');
    expect(returnPeriodOf('2026-04-01', 'quarterly')).toBe('2026-Q1');
    expect(previousReturnPeriod('2026-01')).toBe('2025-12');
    expect(previousReturnPeriod('2026-Q1')).toBe('2025-Q4');
    expect(previousReturnPeriod('2027-Q1')).toBe('2026-Q4');
    expect(returnPeriodsBetween('2026-08', '2026-10')).toEqual(['2026-08', '2026-09', '2026-10']);
  });
  it('dates in the portal form', () => {
    expect(returnDate('2026-09-05')).toBe('05-09-2026');
  });
});

describe('sorting documents into GSTR-1 sections', () => {
  const doc = { sellerState: '33', date: '2026-09-10' };
  it('registered buyers are B2B; bills of supply are not reported', () => {
    expect(outwardSection({ ...doc, invoiceKind: 'business', buyerGstin: '29AAACR1234A1Z1', placeOfSupply: '29', value: '1050' })).toBe('b2b');
    expect(outwardSection({ ...doc, invoiceKind: 'bill_of_supply', placeOfSupply: '33', value: '1050' })).toBe('excluded');
    // A "business" bill without a GSTIN is a consumer bill.
    expect(outwardSection({ ...doc, invoiceKind: 'business', buyerGstin: null, placeOfSupply: '33', value: '1050' })).toBe('b2cs');
  });
  it('B2CL only for other-state consumer invoices above the limit (₹1 lakh from August 2024, ₹2.5 lakh before)', () => {
    expect(largeConsumerLimit('2024-07-31').toString()).toBe('250000');
    expect(largeConsumerLimit('2024-08-01').toString()).toBe('100000');
    expect(outwardSection({ ...doc, invoiceKind: 'consumer', placeOfSupply: '29', value: '100000' })).toBe('b2cs');
    expect(outwardSection({ ...doc, invoiceKind: 'consumer', placeOfSupply: '29', value: '100000.01' })).toBe('b2cl');
    expect(outwardSection({ ...doc, invoiceKind: 'consumer', placeOfSupply: '33', value: '300000' })).toBe('b2cs');
    expect(outwardSection({ ...doc, date: '2024-07-15', invoiceKind: 'consumer', placeOfSupply: '29', value: '200000' })).toBe('b2cs');
  });
  it('credit notes follow their original invoice', () => {
    expect(noteSection({ ...doc, invoiceKind: 'business', buyerGstin: '29AAACR1234A1Z1', placeOfSupply: '29', value: '1050' })).toBe('cdnr');
    expect(noteSection({ ...doc, invoiceKind: 'consumer', placeOfSupply: '29', value: '300000' })).toBe('cdnur');
    expect(noteSection({ ...doc, invoiceKind: 'consumer', placeOfSupply: '33', value: '500' })).toBe('b2cs');
    expect(noteSection(null)).toBe('b2cs');
  });
  it('nil and exempt supply types', () => {
    expect(nilSupplyType(true, true)).toBe('INTRB2B');
    expect(nilSupplyType(false, false)).toBe('INTRAB2C');
  });
});

describe('grouping', () => {
  it('B2CS by state and rate, net of consumer credit notes', () => {
    const rows = [
      { pos: '33', rate: '5', taxable: '1000', cgst: '25', sgst: '25', note: false },
      { pos: '33', rate: '5', taxable: '500', cgst: '12.50', sgst: '12.50', note: false },
      { pos: '33', rate: '18', taxable: '100', cgst: '9', sgst: '9', note: false },
      { pos: '33', rate: '5', taxable: '200', cgst: '5', sgst: '5', note: true },
    ];
    const g = sumFiguresBy(rows, (r) => `${r.pos}|${r.rate}`, (r) => r, (r) => (r.note ? -1 : 1));
    expect([...g.keys()]).toEqual(['33|5', '33|18']);
    expect(g.get('33|5')!.figures.taxable.toFixed(2)).toBe('1300.00');
    expect(g.get('33|5')!.figures.cgst.toFixed(2)).toBe('32.50');
    expect(g.get('33|18')!.count).toBe(1);
  });
  it('HSN digits and unit codes', () => {
    expect(hsnForReturn('62052000', 4)).toBe('6205');
    expect(hsnForReturn('62052000', 6)).toBe('620520');
    expect(hsnForReturn('6205', 6)).toBe('6205');
    expect(uqcFor('PCS')).toBe('PCS');
    expect(uqcFor('KG')).toBe('KGS');
    expect(uqcFor('PKT')).toBe('PAC');
    expect(uqcFor('XYZ')).toBe('OTH');
  });
  it('documents issued per series: first, last, total, cancelled and gaps', () => {
    expect(splitDocumentNumber('MAIN-T1-2026-27-000042')).toEqual({ series: 'MAIN-T1-2026-27-', seq: 42 });
    const rows = documentSeries([
      { number: 'A/0003', cancelled: false },
      { number: 'A/0001', cancelled: false },
      { number: 'A/0002', cancelled: true },
      { number: 'A/0005', cancelled: false },
      { number: 'B-1', cancelled: false },
    ]);
    expect(rows).toEqual([
      { series: 'A/', from: 'A/0001', to: 'A/0005', total: 4, cancelled: 1, net: 3, missing: 1 },
      { series: 'B-', from: 'B-1', to: 'B-1', total: 1, cancelled: 0, net: 1, missing: 0 },
    ]);
  });
  it('invoice numbers the portal accepts', () => {
    expect(invoiceNumberProblem('INV/26-27/0042')).toBeNull();
    expect(invoiceNumberProblem('MAIN-T1-2026-27-000042')).toBe('longer than 16 characters');
    expect(invoiceNumberProblem('INV 42')).not.toBeNull();
  });
});

describe('GSTR-3B set-off in the legal order', () => {
  it('IGST credit pays IGST first, then CGST and SGST; CGST and SGST credit pay their own head, then IGST', () => {
    const r = setOffCredit({ igst: '100', cgst: '50', sgst: '50' }, { igst: '30', cgst: '80', sgst: '10' });
    expect(r.steps.map((x) => [x.credit, x.against, x.amount.toFixed(2)])).toEqual([
      ['igst', 'igst', '30.00'],
      ['cgst', 'cgst', '50.00'],
      ['cgst', 'igst', '30.00'],
      ['sgst', 'sgst', '10.00'],
    ]);
    expect(s(r.cash)).toEqual({ igst: '40.00', cgst: '0.00', sgst: '40.00' });
    expect(s(r.creditLeft)).toEqual({ igst: '0.00', cgst: '0.00', sgst: '0.00' });
  });
  it('CGST credit never pays SGST (and SGST credit never pays CGST): the extra is carried forward', () => {
    const r = setOffCredit({ igst: '0', cgst: '10', sgst: '100' }, { igst: '0', cgst: '100', sgst: '0' });
    expect(s(r.cash)).toEqual({ igst: '0.00', cgst: '0.00', sgst: '100.00' });
    expect(s(r.creditLeft)).toEqual({ igst: '0.00', cgst: '90.00', sgst: '0.00' });
    expect(r.steps.some((x) => x.credit === 'cgst' && x.against === 'sgst')).toBe(false);
  });
  it('IGST credit left over is used up before CGST or SGST credit, where those cannot cover the tax first', () => {
    const r = setOffCredit({ igst: '0', cgst: '100', sgst: '100' }, { igst: '120', cgst: '100', sgst: '0' });
    expect(r.steps.map((x) => [x.credit, x.against, x.amount.toFixed(2)])).toEqual([
      ['igst', 'sgst', '100.00'],
      ['igst', 'cgst', '20.00'],
      ['cgst', 'cgst', '80.00'],
    ]);
    expect(s(r.cash)).toEqual({ igst: '0.00', cgst: '0.00', sgst: '0.00' });
    expect(s(r.creditLeft)).toEqual({ igst: '0.00', cgst: '20.00', sgst: '0.00' });
  });
  it('SGST credit pays IGST only after CGST credit has', () => {
    const r = setOffCredit({ igst: '100', cgst: '0', sgst: '0' }, { igst: '0', cgst: '40', sgst: '100' });
    expect(r.steps.map((x) => [x.credit, x.against, x.amount.toFixed(2)])).toEqual([
      ['cgst', 'igst', '40.00'],
      ['sgst', 'igst', '60.00'],
    ]);
    expect(s(r.creditLeft)).toEqual({ igst: '0.00', cgst: '0.00', sgst: '40.00' });
  });
  it('net payable adds reverse-charge tax in cash; extra credit carries forward and never goes below zero', () => {
    const [sep, oct] = gstPositions([
      { period: '2026-09', output: { cgst: '25', sgst: '25', igst: '50' }, credit: { cgst: '100', sgst: '100', igst: '0' }, reverseCharge: { igst: '1800' } },
      { period: '2026-10', output: { cgst: '120', sgst: '30', igst: '0' }, credit: { cgst: '0', sgst: '0', igst: '0' }, reverseCharge: {} },
    ]);
    // Sept: CGST credit pays CGST 25 then IGST 50; SGST credit pays SGST 25; RCM 1,800 in cash.
    expect(s(sep.cash)).toEqual({ igst: '0.00', cgst: '0.00', sgst: '0.00' });
    expect(s(sep.netPayable)).toEqual({ igst: '1800.00', cgst: '0.00', sgst: '0.00' });
    expect(s(sep.creditLeft)).toEqual({ igst: '0.00', cgst: '25.00', sgst: '75.00' });
    // Oct: brought forward CGST 25, SGST 75.
    expect(s(oct.broughtForward)).toEqual({ igst: '0.00', cgst: '25.00', sgst: '75.00' });
    expect(s(oct.netPayable)).toEqual({ igst: '0.00', cgst: '95.00', sgst: '0.00' });
    expect(s(oct.creditLeft)).toEqual({ igst: '0.00', cgst: '0.00', sgst: '45.00' });
    expect(oct.totalPayable.toFixed(2)).toBe('95.00');
  });
  it('more credit notes than sales: nothing to pay, minus tax is not credit', () => {
    const r = setOffCredit({ igst: '-50', cgst: '0', sgst: '0' }, { igst: '-10', cgst: '5', sgst: '0' });
    expect(s(r.cash)).toEqual({ igst: '0.00', cgst: '0.00', sgst: '0.00' });
    expect(s(r.creditLeft)).toEqual({ igst: '0.00', cgst: '5.00', sgst: '0.00' });
  });
});

describe('GSTR-1 offline-tool JSON', () => {
  it('uses the portal field names, plus amounts on notes and one entry per buyer', () => {
    const item = { rate: '5.00', taxable: '1000.00', igst: '50.00', cgst: '0.00', sgst: '0.00', cess: '0.00' };
    const j = JSON.parse(stringifyPortalJson(gstr1PortalJson(
      {
        gstin: '33AAACR1234A1ZV',
        fp: '092026',
        b2b: [{ number: 'B/1', date: '2026-09-02', value: '1050.00', placeOfSupply: '29', buyerGstin: '29AAACR1234A1Z1', reverseCharge: false, items: [item] }],
        b2cl: [],
        b2cs: [{ supplyType: 'INTRA', placeOfSupply: '33', rate: '5.00', taxable: '800.00', igst: '0.00', cgst: '20.00', sgst: '20.00', cess: '0.00' }],
        cdnr: [{ number: 'B/2', date: '2026-09-03', value: '-1050.00', placeOfSupply: '29', buyerGstin: '29AAACR1234A1Z1', reverseCharge: false, noteType: 'C', items: [{ ...item, taxable: '-1000.00', igst: '-50.00' }] }],
        cdnur: [],
        nil: [],
        hsnBusiness: [{ hsn: '6205', description: 'Shirts', uqc: 'PCS', quantity: '0.000', rate: '5.00', taxable: '0.00', igst: '0.00', cgst: '0.00', sgst: '0.00', cess: '0.00' }],
        hsnConsumer: [],
        documents: [{ nature: 1, series: 'B/', from: 'B/1', to: 'B/1', total: 1, cancelled: 0, net: 1, missing: 0 }],
      },
      '33',
    )));
    expect(j).toEqual({
      gstin: '33AAACR1234A1ZV',
      fp: '092026',
      b2b: [{ ctin: '29AAACR1234A1Z1', inv: [{ inum: 'B/1', idt: '02-09-2026', val: 1050, pos: '29', rchrg: 'N', inv_typ: 'R', itms: [{ num: 1, itm_det: { rt: 5, txval: 1000, iamt: 50, csamt: 0 } }] }] }],
      b2cs: [{ sply_ty: 'INTRA', pos: '33', typ: 'OE', rt: 5, txval: 800, camt: 20, samt: 20, csamt: 0 }],
      cdnr: [{ ctin: '29AAACR1234A1Z1', nt: [{ ntty: 'C', nt_num: 'B/2', nt_dt: '03-09-2026', val: 1050, pos: '29', rchrg: 'N', inv_typ: 'R', itms: [{ num: 1, itm_det: { rt: 5, txval: 1000, iamt: 50, csamt: 0 } }] }] }],
      hsn: { hsn_b2b: [{ num: 1, hsn_sc: '6205', desc: 'Shirts', uqc: 'PCS', qty: 0, rt: 5, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 }] },
      doc_issue: { doc_det: [{ doc_num: 1, doc_typ: 'Invoices for outward supply', docs: [{ num: 1, from: 'B/1', to: 'B/1', totnum: 1, cancel: 0, net_issue: 1 }] }] },
    });
  });
});
