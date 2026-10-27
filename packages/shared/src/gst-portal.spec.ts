// Copyright (c) 2026, Rademics. All rights reserved.
import { describe, expect, it } from 'vitest';
import {
  buildEInvoiceJson,
  buildEWayBill,
  eInvoiceCancellable,
  eInvoiceLastDay,
  eInvoiceNearLimit,
  eInvoiceNumberProblem,
  eInvoiceProblems,
  type EInvoiceSource,
  eWayBulkFile,
  eWayDocumentProblems,
  eWayLimitFor,
  eWayRequired,
  eWayValidityDays,
  eWayValidUntil,
  eWayValue,
  parseCsv,
  parseEInvoiceResults,
  parseEWayResults,
  parsePortalDateTime,
  stringifyPortalJson,
  jm,
  toPortalDate,
  uqcFor,
} from './gst-portal.js';

describe('e-way bill rules (plan 08 §4, decision 58, scenario 8.10)', () => {
  it('gives one day per 200 km or part of it', () => {
    expect(eWayValidityDays(0)).toBe(1);
    expect(eWayValidityDays(1)).toBe(1);
    expect(eWayValidityDays(200)).toBe(1);
    expect(eWayValidityDays(201)).toBe(2);
    expect(eWayValidityDays(450)).toBe(3);
    expect(eWayValidityDays(4000)).toBe(20);
    expect(() => eWayValidityDays(-1)).toThrow();
  });

  it('ends validity at midnight (Indian time), the first day ending at the midnight after the day it was made', () => {
    // Made 14 March at 00:04 or at 23:58: one day runs to the end of 15 March (official FAQ example).
    expect(eWayValidUntil(new Date('2026-03-14T00:04:00+05:30'), 100).toISOString()).toBe(new Date('2026-03-15T23:59:59+05:30').toISOString());
    expect(eWayValidUntil(new Date('2026-03-14T23:58:00+05:30'), 100).toISOString()).toBe(new Date('2026-03-15T23:59:59+05:30').toISOString());
    // 450 km: three days.
    expect(eWayValidUntil(new Date('2026-10-18T10:30:00+05:30'), 450).toISOString()).toBe(new Date('2026-10-21T23:59:59+05:30').toISOString());
    // 00:30 IST is still the previous day in UTC; the Indian date counts.
    expect(eWayValidUntil(new Date('2026-04-01T00:30:00+05:30'), 50).toISOString()).toBe(new Date('2026-04-02T23:59:59+05:30').toISOString());
  });

  it('values the consignment with tax, leaving out exempt goods and freight', () => {
    expect(eWayValue([{ total: '40000.50' }, { total: '25000' }, { total: '9000', exempt: true }, { total: '500', freight: true }]).toFixed(2)).toBe('65000.50');
  });

  it('uses the other-state limit, or a state’s own limit inside one state', () => {
    const limits = { limit: '50000', stateLimits: { '33': '100000', '27': null } };
    expect(eWayLimitFor({ fromState: '29', toState: '33', ...limits }).toFixed(0)).toBe('50000');
    expect(eWayLimitFor({ fromState: '33', toState: '33', ...limits }).toFixed(0)).toBe('100000');
    expect(eWayLimitFor({ fromState: '27', toState: '27', ...limits }).toFixed(0)).toBe('50000');
    expect(eWayRequired('60000', { fromState: '29', toState: '33', ...limits })).toBe(true);
    expect(eWayRequired('50000', { fromState: '29', toState: '33', ...limits })).toBe(false); // must exceed
    expect(eWayRequired('60000', { fromState: '33', toState: '33', ...limits })).toBe(false);
  });

  it('refuses documents over 180 days old, over 250 lines, services only or too far', () => {
    expect(eWayDocumentProblems({ documentDate: '2026-04-21', today: '2026-10-18', lineCount: 3, goodsLineCount: 3 })).toEqual([]);
    expect(eWayDocumentProblems({ documentDate: '2026-04-20', today: '2026-10-18', lineCount: 3, goodsLineCount: 3 })[0]).toMatch(/180 days/);
    expect(eWayDocumentProblems({ documentDate: '2026-10-18', today: '2026-10-18', lineCount: 251, goodsLineCount: 251 })[0]).toMatch(/250/);
    expect(eWayDocumentProblems({ documentDate: '2026-10-18', today: '2026-10-18', lineCount: 1, goodsLineCount: 0 })[0]).toMatch(/services/);
    expect(eWayDocumentProblems({ documentDate: '2026-10-18', today: '2026-10-18', lineCount: 1, goodsLineCount: 1, distanceKm: 4001 })[0]).toMatch(/4000/);
  });
});

describe('e-invoice rules', () => {
  it('allows cancelling within 24 hours of registration only', () => {
    const at = new Date('2026-10-18T10:00:00+05:30');
    expect(eInvoiceCancellable(at, new Date('2026-10-19T10:00:00+05:30'))).toBe(true);
    expect(eInvoiceCancellable(at, new Date('2026-10-19T10:00:01+05:30'))).toBe(false);
    expect(eInvoiceCancellable(null)).toBe(false);
  });

  it('flags waiting invoices near the 30-day limit for ₹10 crore and above only', () => {
    expect(eInvoiceLastDay('2026-10-01')).toBe('2026-10-31');
    const base = { status: 'waiting', documentDate: '2026-10-01', turnoverBand: 'above_10cr' };
    expect(eInvoiceNearLimit({ ...base, today: '2026-10-25' })).toBe(false);
    expect(eInvoiceNearLimit({ ...base, today: '2026-10-26' })).toBe(true);
    expect(eInvoiceNearLimit({ ...base, today: '2026-11-05' })).toBe(true);
    expect(eInvoiceNearLimit({ ...base, today: '2026-10-28', turnoverBand: '5cr_to_10cr' })).toBe(false);
    expect(eInvoiceNearLimit({ ...base, today: '2026-10-28', status: 'registered' })).toBe(false);
  });

  it('checks document numbers as the portal does', () => {
    expect(eInvoiceNumberProblem('S1-T1/000123')).toBeNull();
    expect(eInvoiceNumberProblem('0123')).toMatch(/must not start/);
    expect(eInvoiceNumberProblem('abc')).toMatch(/capital/);
    expect(eInvoiceNumberProblem('A'.repeat(17))).toMatch(/16/);
  });

  it('maps our units to the official unit codes', () => {
    expect(uqcFor('PCS')).toBe('PCS');
    expect(uqcFor('kg')).toBe('KGS');
    expect(uqcFor('ML')).toBe('MLT');
    expect(uqcFor('WEIRD')).toBe('OTH');
  });
});

const source: EInvoiceSource = {
  typ: 'INV',
  number: 'B1-000045',
  date: '2026-10-18',
  seller: { gstin: '29AAACR1234A1ZZ', legalName: 'Rademics Retail Pvt Ltd', addr1: '12 MG Road', place: 'Bengaluru', pincode: '560001', stateCode: '29' },
  buyer: { gstin: '33AAACB5678B1Z0', legalName: 'Buyer Traders', placeOfSupply: '33', addr1: '4 Anna Salai', place: 'Chennai', pincode: '600002', stateCode: '33' },
  lines: [
    { description: 'Cotton shirt', isService: false, hsn: '620520', quantity: '3', unit: 'PCS', taxable: '2678.57', gstRate: '12', igst: '321.43', cgst: '0', sgst: '0' },
    { description: 'Silk saree', isService: false, hsn: '50072010', quantity: '1', unit: 'PCS', taxable: '9523.81', gstRate: '5', igst: '476.19', cgst: '0', sgst: '0' },
  ],
  roundOff: '0',
  total: '13000.00',
};

describe('e-invoice JSON (notified schema 1.1)', () => {
  it('builds the invoice with the official keys, exact amounts and DD/MM/YYYY dates', () => {
    const json = buildEInvoiceJson(source);
    const text = stringifyPortalJson([json]);
    const parsed = JSON.parse(text) as Record<string, any>[];
    const inv = parsed[0];
    expect(inv.Version).toBe('1.1');
    expect(inv.TranDtls).toMatchObject({ TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N' });
    expect(inv.DocDtls).toEqual({ Typ: 'INV', No: 'B1-000045', Dt: '18/10/2026' });
    expect(inv.SellerDtls).toMatchObject({ Gstin: '29AAACR1234A1ZZ', Pin: 560001, Stcd: '29', Loc: 'Bengaluru' });
    expect(inv.BuyerDtls).toMatchObject({ Gstin: '33AAACB5678B1Z0', Pos: '33', Stcd: '33' });
    expect(inv.ItemList).toHaveLength(2);
    expect(inv.ItemList[0]).toMatchObject({ SlNo: '1', IsServc: 'N', HsnCd: '620520', Qty: 3, Unit: 'PCS', UnitPrice: 892.857, TotAmt: 2678.57, AssAmt: 2678.57, GstRt: 12, IgstAmt: 321.43, TotItemVal: 3000 });
    expect(inv.ValDtls).toMatchObject({ AssVal: 12202.38, IgstVal: 797.62, CgstVal: 0, TotInvVal: 13000, RndOffAmt: 0 });
    // Numbers are written from their decimal text, never through floating point.
    expect(text).toContain('"AssVal": 12202.38');
    expect(text).toContain('"UnitPrice": 892.857');
    expect(eInvoiceProblems(source)).toEqual([]);
  });

  it('makes credit notes with positive amounts and the original invoice', () => {
    const inv = JSON.parse(stringifyPortalJson(buildEInvoiceJson({ ...source, typ: 'CRN', number: 'R1-000002', lines: [{ ...source.lines[0], quantity: '-1', taxable: '-892.86', igst: '-107.14' }], total: '-1000', original: { number: 'B1-000045', date: '2026-10-18' } })));
    expect(inv.DocDtls.Typ).toBe('CRN');
    expect(inv.ItemList[0]).toMatchObject({ Qty: 1, AssAmt: 892.86, IgstAmt: 107.14 });
    expect(inv.ValDtls.TotInvVal).toBe(1000);
    expect(inv.RefDtls.PrecDocDtls[0]).toEqual({ InvNo: 'B1-000045', InvDt: '18/10/2026' });
  });

  it('lists what stops an invoice being accepted', () => {
    const problems = eInvoiceProblems({ ...source, number: 'b-1', buyer: { ...source.buyer, pincode: null, place: '', stateCode: '29' } });
    expect(problems.join(' | ')).toMatch(/capital letters/);
    expect(problems.join(' | ')).toMatch(/buyer town/);
    expect(problems.join(' | ')).toMatch(/first two digits/);
  });

  it('writes money as JSON numbers exactly', () => {
    expect(stringifyPortalJson({ a: jm('0.1'), b: jm('100.00'), c: jm('-2.005') }, 0)).toBe('{"a":0.1,"b":100,"c":-2.01}');
  });
});

describe('e-way bill bulk JSON (attributes version 1.0.0621)', () => {
  it('builds { version, billLists } with the official keys', () => {
    const bill = buildEWayBill({
      userGstin: '29AAACR1234A1ZZ',
      subSupplyType: 8,
      subSupplyDesc: 'Branch transfer',
      docType: 'CHL',
      number: 'TS-000012',
      date: '2026-10-18',
      from: { gstin: '29AAACR1234A1ZZ', name: 'Rademics MG Road', addr1: '12 MG Road', place: 'Bengaluru', pincode: '560001', stateCode: '29' },
      to: { gstin: '33AAACR1234A1ZA', name: 'Rademics Chennai', addr1: '4 Anna Salai', place: 'Chennai', pincode: '600002', stateCode: '33' },
      lines: [{ name: 'Cotton shirt', hsn: '620520', quantity: '100', unit: 'PCS', taxable: '60000', cgstRate: '0', sgstRate: '0', igstRate: '0' }],
      totals: { taxable: '60000', cgst: '0', sgst: '0', igst: '0', total: '60000' },
      distanceKm: 450,
      transporterId: null,
      vehicleNo: 'ka 01 ab 1234',
    });
    const file = JSON.parse(eWayBulkFile([bill]));
    expect(file.version).toBe('1.0.0621');
    expect(file.billLists[0]).toMatchObject({
      userGstin: '29AAACR1234A1ZZ',
      supplyType: 'O',
      subSupplyType: 8,
      docType: 'CHL',
      docNo: 'TS-000012',
      docDate: '18/10/2026',
      transType: 1,
      fromPincode: 560001,
      fromStateCode: 29,
      actualToStateCode: 33,
      totInvValue: 60000,
      transMode: 1,
      transDistance: 450,
      vehicleNo: 'KA01AB1234',
      vehicleType: 'R',
      mainHsnCode: '620520',
    });
    expect(file.billLists[0].itemList[0]).toMatchObject({ itemNo: 1, hsnCode: '620520', quantity: 100, qtyUnit: 'PCS', taxableAmount: 60000 });
  });
});

describe('reading the portals’ answer files', () => {
  const jwt = (claims: object) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`;

  it('reads the bulk JSON result: IRN, acknowledgement and signed QR, matched by document number', () => {
    const qr = jwt({ data: JSON.stringify({ SellerGstin: '29AAACR1234A1ZZ', DocNo: 'B1-000045', DocTyp: 'INV', Irn: 'a'.repeat(64) }), iss: 'NIC' });
    const rows = parseEInvoiceResults(JSON.stringify([{ AckNo: 112010000002315, AckDt: '2026-10-18 15:18:00', Irn: 'a'.repeat(64), SignedQRCode: qr, Status: 'ACT' }]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ documentNumber: 'B1-000045', irn: 'a'.repeat(64), ackNumber: '112010000002315', outcome: 'registered', signedQr: qr });
    expect(rows[0].ackDate?.toISOString()).toBe(new Date('2026-10-18T15:18:00+05:30').toISOString());
  });

  it('reads the CSV result and the error file', () => {
    const csv = 'Seller GSTIN,Buyer GSTIN,Document Type,Document No.,Document Date,Ack No.,Ack Date,IRN,Status,Signed QR Code\r\n29AAACR1234A1Z5,33AAACB5678B1Z0,INV,B1-000045,18/10/2026,1120100,"18/10/2026 03:18:00 PM",' + 'b'.repeat(64) + ',ACT,eyJ.x.y\r\n';
    const ok = parseEInvoiceResults(csv);
    expect(ok[0]).toMatchObject({ documentNumber: 'B1-000045', ackNumber: '1120100', outcome: 'registered', signedQr: 'eyJ.x.y' });
    expect(ok[0].ackDate?.toISOString()).toBe(new Date('2026-10-18T15:18:00+05:30').toISOString());
    const bad = parseEInvoiceResults('Seller GSTIN,Document No.,Error Code,Error Description\n29AAACR1234A1Z5,B1-000046,2150,Duplicate IRN\n');
    expect(bad[0]).toMatchObject({ documentNumber: 'B1-000046', outcome: 'failed', error: '2150: Duplicate IRN' });
    const nested = parseEInvoiceResults(JSON.stringify({ Status: '0', DocDtls: { No: 'B1-000047' }, ErrorDetails: [{ ErrorCode: '2172', ErrorMessage: 'Invalid buyer GSTIN' }] }));
    expect(nested[0]).toMatchObject({ documentNumber: 'B1-000047', outcome: 'failed', error: '2172: Invalid buyer GSTIN' });
  });

  it('reads cancellations', () => {
    const rows = parseEInvoiceResults('Seller GSTIN,IRN Number,IRN Cancel Date\n29AAACR1234A1Z5,' + 'c'.repeat(64) + ',18/10/2026 16:00:00\n');
    expect(rows[0]).toMatchObject({ irn: 'c'.repeat(64), outcome: 'cancelled' });
  });

  it('reads e-way bill numbers and validity', () => {
    const rows = parseEWayResults(JSON.stringify([{ docNo: 'TS-000012', ewayBillNo: 123456789012, ewayBillDate: '18/10/2026 10:30:00 AM', validUpto: '21/10/2026 11:59:00 PM' }]));
    expect(rows[0]).toMatchObject({ documentNumber: 'TS-000012', number: '123456789012' });
    expect(rows[0].generatedAt?.toISOString()).toBe(new Date('2026-10-18T10:30:00+05:30').toISOString());
    expect(rows[0].validUntil?.toISOString()).toBe(new Date('2026-10-21T23:59:00+05:30').toISOString());
  });

  it('parses portal dates and CSV quoting', () => {
    expect(parsePortalDateTime('26/09/2018 12.00:00 PM')?.toISOString()).toBe(new Date('2018-09-26T12:00:00+05:30').toISOString());
    expect(parsePortalDateTime('05/08/2020')?.toISOString()).toBe(new Date('2020-08-05T00:00:00+05:30').toISOString());
    expect(parsePortalDateTime('nonsense')).toBeNull();
    expect(parseCsv('a,"b ""q"", c"\n1,2')).toEqual([['a', 'b "q", c'], ['1', '2']]);
    expect(toPortalDate('2026-04-01')).toBe('01/04/2026');
  });
});
