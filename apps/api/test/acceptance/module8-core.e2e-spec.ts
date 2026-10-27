// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, "Module 8" scenarios 8.1–8.6
// and 8.11 (GST common core at the till: rates by date and price, place of
// supply, business tax invoices, credit notes, composition, CA approval).
// Amounts use test rates entered for these scenarios.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { businessDate, Decimal, gstinCheckCharacter, shortFinancialYear } from 'shared';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let MAIN: string;
let loc: Record<string, string>;
let pcs: string;
let groupId: string;
let listId: string;
let pm: Record<string, string>;
let tillId: string;
let tillToken: string;
let shiftId: string;
let shiftClientId: string;
const counters: Record<string, number> = {};

const today = () => businessDate();
const num = (fy = '2026-27') => `MAT1/${shortFinancialYear(fy)}/${String((counters[fy] = (counters[fy] ?? 0) + 1)).padStart(6, '0')}`;
const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);
const withCheck = (first14: string) => `${first14}${gstinCheckCharacter(first14)}`;
/** A Karnataka (29) GSTIN with a correct check character. */
const KA_GSTIN = withCheck('29AABCK1234A1Z');

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

async function freshTill() {
  owner = await setUpCompany(app, prisma);
  for (const k of Object.keys(counters)) delete counters[k];
  MAIN = await storeId(prisma, 'MAIN');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'APP', name: 'Apparel' }).expect(201)).body.id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  // 8.3: HSN 6205 at 5% up to ₹2,500 a piece, 18% above (from 22 September 2025); 12% before.
  await owner.post('/pos/gst-rates').send({ hsnCode: '6205', rate: '12', effectiveFrom: '2024-04-01' }).expect(201);
  await owner.post('/pos/gst-rates').send({ hsnCode: '6205', rate: '5', priceUpTo: '2500', effectiveFrom: '2025-09-22' }).expect(201);
  await owner.post('/pos/gst-rates').send({ hsnCode: '6205', rate: '18', priceFrom: '2500', effectiveFrom: '2025-09-22' }).expect(201);
  // 8.4: HSN 3304 at 12% until 21 September 2025, 5% from 22 September 2025.
  await owner.post('/pos/gst-rates').send({ hsnCode: '3304', rate: '12', effectiveFrom: '2025-04-01' }).expect(201);
  await owner.post('/pos/gst-rates').send({ hsnCode: '3304', rate: '5', effectiveFrom: '2025-09-22' }).expect(201);
  await owner.post('/pos/gst-rates').send({ hsnCode: '8471', rate: '18', effectiveFrom: '2025-04-01' }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  tillId = (
    await owner
      .post('/pos/tills')
      .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, cashierDiscountPercent: '25', paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }, { paymentMethodId: pm.CARD }] })
      .expect(201)
  ).body.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
  shiftClientId = randomUUID();
  shiftId = (await T(owner.post('/pos/shifts')).send({ clientId: shiftClientId, tillId, cash: [{ paymentMethodId: pm.CASH, amount: '1000' }] }).expect(201)).body.id;
}

async function item(name: string, hsnCode: string, price: string) {
  const i = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode, maxDiscountPercent: '30' }).expect(201)).body as { id: string; code: string };
  await owner.post('/prices').send({ priceListId: listId, itemId: i.id, price, startDate: '2024-04-01' }).expect(201);
  const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: i.id, countedQuantity: '20', unitCost: '100' }] }).expect(201)).body;
  await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
  return i;
}

function sale(lines: Record<string, unknown>[], amount: string, extra: Record<string, unknown> = {}) {
  return { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments: [{ paymentMethodId: pm.CASH, amount }], ...extra };
}

/** A bill made offline on an earlier day (sent later from the till's queue). */
function offlineSale(date: string, fy: string, lines: Record<string, unknown>[], amount: string) {
  return { clientId: randomUUID(), tillId, shiftClientId, offline: true, soldAt: `${date}T11:00:00+05:30`, sale: { number: num(fy), lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments: [{ paymentMethodId: pm.CASH, amount }] };
}

async function bal(key: string): Promise<string> {
  const account = await prisma.account.findFirstOrThrow({ where: { systemKey: key } });
  const s = await prisma.ledgerLine.aggregate({ where: { accountId: account.id }, _sum: { debit: true, credit: true } });
  return new Decimal(s._sum.debit?.toString() ?? '0').sub(new Decimal(s._sum.credit?.toString() ?? '0')).toFixed(2);
}

const lineTax = (l: Record<string, string>) => [l.gstRate, l.taxableAmount, l.cgst, l.sgst, l.igst];

describe('Module 8: GST at the till', () => {
  let shirt: { id: string; code: string };
  let shirt2000: { id: string };
  let shirt3000: { id: string };
  let cream: { id: string };
  let laptop: { id: string };
  let first: Record<string, any>;

  beforeAll(async () => {
    await freshTill();
    shirt = await item('Cotton Shirt', '62052000', '1050');
    shirt2000 = await item('Linen Shirt', '62052000', '2000');
    shirt3000 = await item('Silk Shirt', '62052000', '3000');
    cream = await item('Face Cream', '33049910', '112');
    laptop = await item('Laptop', '84713010', '70800');
  });

  it('8.1 consumer bill in the same state: taxable ₹1,000.00, CGST ₹25.00, SGST ₹25.00, HSN per line, store GSTIN; output tax posted at shift close', async () => {
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050')).expect(201)).body;
    first = res.sale;
    expect(first).toMatchObject({ total: '1050.00', taxableAmount: '1000.00', cgst: '25.00', sgst: '25.00', igst: '0.00', invoiceKind: 'consumer', placeOfSupply: '33', documentTitle: 'Tax invoice', sellerGstin: '33AAACR1234A1ZA' });
    // CGST rule 46(b): at most 16 characters.
    expect(first.number).toBe('MAT1/2627/000001');
    expect(first.lines[0]).toMatchObject({ hsnCode: '62052000', gstRate: '5' });
    const receipt = res.receipts[0];
    expect(receipt.gst).toMatchObject({ title: 'Tax invoice', sellerGstin: '33AAACR1234A1ZA', placeOfSupply: { code: '33', name: 'Tamil Nadu' }, reverseCharge: false, original: null, declaration: null });
    expect(receipt.lines[0].hsn).toBe('6205');
    expect(receipt.gstTable).toEqual([{ rate: '5', taxable: '1000.00', cgst: '25.00', sgst: '25.00', igst: '0.00' }]);
    // The A4 tax invoice carries the CBIC invoice fields.
    const a4 = (await owner.get(`/print/pos_bill/${first.id}`).expect(200)).body;
    expect(a4).toMatchObject({ title: 'Tax invoice', number: first.number, letterhead: { gstin: '33AAACR1234A1ZA' } });
    expect(a4.details).toEqual(expect.arrayContaining([['Place of supply', 'Tamil Nadu (33)'], ['Reverse charge', 'No']]));
    expect(a4.lines[0]).toMatchObject({ hsn: '6205', quantity: '1 PCS', taxable: '1000.00', gst: '5%', cgst: '25.00', sgst: '25.00' });
  });

  it('8.2 business invoice to a Karnataka buyer: IGST ₹50.00, no CGST/SGST; a bad GSTIN is refused in plain words', async () => {
    const buyer = { gstin: KA_GSTIN, name: 'Kaveri Traders', address: '12 MG Road, Bengaluru 560001' };
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050', { buyer })).expect(201)).body;
    expect(res.sale).toMatchObject({ invoiceKind: 'business', buyerGstin: KA_GSTIN, buyerName: 'Kaveri Traders', buyerAddress: buyer.address, buyerStateCode: '29', placeOfSupply: '29', taxableAmount: '1000.00', igst: '50.00', cgst: '0.00', sgst: '0.00' });
    expect(res.receipts[0].gst).toMatchObject({ title: 'Tax invoice', interState: true, buyer: { name: 'Kaveri Traders', gstin: KA_GSTIN, state: { code: '29', name: 'Karnataka' } }, placeOfSupply: { code: '29', name: 'Karnataka' } });
    const a4 = (await owner.get(`/print/pos_bill/${res.sale.id}`).expect(200)).body;
    expect(a4.party).toMatchObject({ label: 'Buyer', name: 'Kaveri Traders', gstin: KA_GSTIN });
    expect(a4.columns.map((c: { key: string }) => c.key)).toContain('igst');
    expect(a4.details).toEqual(expect.arrayContaining([['Place of supply', 'Karnataka (29)']]));

    const typo = KA_GSTIN.slice(0, 14) + (KA_GSTIN[14] === 'A' ? 'B' : 'A');
    const bad = await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050', { buyer: { ...buyer, gstin: typo } })).expect(400);
    expect(JSON.stringify(bad.body)).toMatch(/typing mistake/);
    counters['2026-27']--;
    const noName = await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050', { buyer: { gstin: KA_GSTIN } })).expect(400);
    expect(JSON.stringify(noName.body)).toMatch(/name and address/);
    counters['2026-27']--;
  });

  it('8.2 a customer with a GSTIN on file gets a business invoice; a delivery to another state is IGST', async () => {
    const cust = (await owner.post('/customers').send({ name: 'Kaveri Traders', gstin: KA_GSTIN, address: { addressLine1: '12 MG Road', city: 'Bengaluru', stateCode: '29', pincode: '560001' } }).expect(201)).body;
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050', { customerId: cust.id })).expect(201)).body;
    expect(res.sale).toMatchObject({ invoiceKind: 'business', buyerGstin: KA_GSTIN, buyerAddress: '12 MG Road, Bengaluru 560001', placeOfSupply: '29', igst: '50.00' });
    const home = (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050', { delivery: { address: '5 Beach Road, Kochi', stateCode: '32' } })).expect(201)).body;
    expect(home.sale).toMatchObject({ invoiceKind: 'consumer', placeOfSupply: '32', igst: '50.00', cgst: '0.00' });
  });

  it('8.3 rate by selling price: ₹2,000 at 5% and ₹3,000 at 18% on one bill; two HSN summary lines; a discount can bring a shirt into the lower band', async () => {
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt2000.id, quantity: '1' }, { itemId: shirt3000.id, quantity: '1' }], '5000')).expect(201)).body;
    expect(res.sale.lines.map(lineTax)).toEqual([
      ['5', '1904.76', '47.62', '47.62', '0.00'],
      ['18', '2542.37', '228.82', '228.81', '0.00'],
    ]);
    expect(res.sale).toMatchObject({ taxableAmount: '4447.13', cgst: '276.44', sgst: '276.43', total: '5000.00' });
    const summary = new Map<string, Decimal>();
    for (const l of res.sale.lines) summary.set(`${l.hsnCode.slice(0, 4)}@${l.gstRate}`, (summary.get(`${l.hsnCode.slice(0, 4)}@${l.gstRate}`) ?? new Decimal(0)).add(l.taxableAmount));
    expect([...summary.keys()]).toEqual(['6205@5', '6205@18']);
    // ₹3,000 less 20% = ₹2,400 a piece: the 5% band.
    const owner20 = (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt3000.id, quantity: '1', discountPercent: '20' }], '2400')).expect(201)).body;
    expect(owner20.sale.lines[0].gstRate).toBe('5');
  });

  let oldCream: Record<string, any>;
  it('8.4 rate change by date: 12% on 21 September 2025, 5% from 22 September 2025; a reprint keeps 12%', async () => {
    await owner.post('/financial-years').send({ startDate: '2025-04-01', endDate: '2026-03-31' }).expect(201);
    const before = (await T(owner.post('/pos/bills')).send(offlineSale('2025-09-21', '2025-26', [{ itemId: cream.id, quantity: '1' }], '112')).expect(201)).body;
    oldCream = before.sale;
    expect(oldCream.lines.map(lineTax)).toEqual([['12', '100.00', '6.00', '6.00', '0.00']]);
    const after = (await T(owner.post('/pos/bills')).send(offlineSale('2025-09-22', '2025-26', [{ itemId: cream.id, quantity: '1' }], '112')).expect(201)).body;
    expect(after.sale.lines.map(lineTax)).toEqual([['5', '106.67', '2.67', '2.66', '0.00']]);
    const now = (await T(owner.post('/pos/bills')).send(sale([{ itemId: cream.id, quantity: '1' }], '112')).expect(201)).body;
    expect(now.sale.lines[0].gstRate).toBe('5');
    const reprint = (await owner.post(`/pos/bills/${oldCream.id}/reprint`).expect(200)).body;
    expect(reprint).toMatchObject({ duplicate: true, gstTable: [{ rate: '12', taxable: '100.00', cgst: '6.00', sgst: '6.00', igst: '0.00' }] });
  });

  it('8.5 a return of the 8.1 shirt is a credit note naming the original bill; it reverses taxable ₹1,000.00, CGST ₹25.00, SGST ₹25.00', async () => {
    const back = { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), ret: { number: num(), returnOfId: first.id, lines: [{ lineNo: 1, itemId: shirt.id, quantity: '1', returnOfLineId: first.lines[0].id }] }, payments: [{ paymentMethodId: pm.CASH, amount: '-1050' }] };
    const res = (await T(owner.post('/pos/bills')).send(back).expect(201)).body;
    expect(res.return).toMatchObject({ total: '-1050.00', taxableAmount: '-1000.00', cgst: '-25.00', sgst: '-25.00', igst: '0.00', documentTitle: 'Credit note', invoiceKind: 'consumer', placeOfSupply: '33', creditNoteLate: false, originalBill: { number: first.number, date: today() } });
    expect(res.receipts[0].gst).toMatchObject({ title: 'Credit note', original: { number: first.number, date: today() } });
    expect(res.warnings).toEqual([]);
    const a4 = (await owner.get(`/print/pos_bill/${res.return.id}`).expect(200)).body;
    expect(a4.title).toBe('Credit note');
    expect(a4.details).toEqual(expect.arrayContaining([['Against invoice', `${first.number} dated ${today()}`]]));
    // The reports read credit notes from returns with their original bill.
    const row = await prisma.posBill.findUniqueOrThrow({ where: { id: res.return.id } });
    expect(row).toMatchObject({ kind: 'return', returnOfId: first.id, invoiceKind: 'consumer', placeOfSupply: '33' });
  });

  it('8.5 a credit note after 30 November of the next financial year still refunds and returns stock, with a warning', async () => {
    await owner.post('/financial-years').send({ startDate: '2024-04-01', endDate: '2025-03-31' }).expect(201);
    const old = (await T(owner.post('/pos/bills')).send(offlineSale('2025-03-15', '2024-25', [{ itemId: shirt.id, quantity: '1' }], '1050')).expect(201)).body.sale;
    expect(old.lines.map(lineTax)).toEqual([['12', '937.50', '56.25', '56.25', '0.00']]);
    const stockBefore = await prisma.stockPosition.findUniqueOrThrow({ where: { itemId_locationId: { itemId: shirt.id, locationId: loc['MAIN-FLOOR'] } } });
    const back = { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), ret: { number: num(), returnOfId: old.id, lines: [{ lineNo: 1, itemId: shirt.id, quantity: '1', returnOfLineId: old.lines[0].id }] }, payments: [{ paymentMethodId: pm.CASH, amount: '-1050' }] };
    const res = (await T(owner.post('/pos/bills')).send(back).expect(201)).body;
    expect(res.return).toMatchObject({ total: '-1050.00', taxableAmount: '-937.50', cgst: '-56.25', sgst: '-56.25', creditNoteLate: true });
    expect(res.return.checkFlags).toContain('credit_note_late');
    expect(res.warnings.join(' ')).toMatch(/after 2025-11-30.*can no longer be reduced/);
    expect(res.receipts[0].gst.creditNoteLate).toBe(true);
    const stockAfter = await prisma.stockPosition.findUniqueOrThrow({ where: { itemId_locationId: { itemId: shirt.id, locationId: loc['MAIN-FLOOR'] } } });
    expect(new Decimal(stockAfter.quantity.toString()).sub(stockBefore.quantity.toString()).toString()).toBe('1');
  });

  it('8.5 a return of the business invoice to Karnataka reverses IGST', async () => {
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050', { buyer: { gstin: KA_GSTIN, name: 'Kaveri Traders', address: 'Bengaluru' } })).expect(201)).body.sale;
    const back = { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), ret: { number: num(), returnOfId: res.id, lines: [{ lineNo: 1, itemId: shirt.id, quantity: '1', returnOfLineId: res.lines[0].id }] }, payments: [{ paymentMethodId: pm.CASH, amount: '-1050' }] };
    const ret = (await T(owner.post('/pos/bills')).send(back).expect(201)).body.return;
    expect(ret).toMatchObject({ invoiceKind: 'business', buyerGstin: KA_GSTIN, placeOfSupply: '29', igst: '-50.00', cgst: '0.00', taxableAmount: '-1000.00' });
  });

  it('G5 a consumer bill of ₹50,000 or more taxable value needs the buyer’s name, address and state', async () => {
    const without = await T(owner.post('/pos/bills')).send(sale([{ itemId: laptop.id, quantity: '1' }], '70800')).expect(400);
    expect(without.body.message).toMatch(/₹50,000 or more.*name, address and state/);
    counters['2026-27']--;
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: laptop.id, quantity: '1' }], '70800', { buyer: { name: 'Anil Kumar', address: '4 Lake View, Chennai', stateCode: '33' } })).expect(201)).body.sale;
    expect(res).toMatchObject({ invoiceKind: 'consumer', buyerName: 'Anil Kumar', buyerStateCode: '33', taxableAmount: '60000.00', cgst: '5400.00', sgst: '5400.00' });
  });

  it('8.1 accounts: output CGST and SGST are credited when the shift closes', async () => {
    const bills = await prisma.posBill.findMany({ where: { shiftId, status: 'completed' } });
    const cgst = bills.reduce((s, b) => s.add(b.cgst.toString()), new Decimal(0));
    const sgst = bills.reduce((s, b) => s.add(b.sgst.toString()), new Decimal(0));
    const igst = bills.reduce((s, b) => s.add(b.igst.toString()), new Decimal(0));
    const shift = (await owner.get(`/pos/till/${tillId}/shift`).expect(200)).body;
    const cash = shift.expected.find((e: { paymentMethodId: string }) => e.paymentMethodId === pm.CASH).expected as string;
    let left = Number(new Decimal(cash).toFixed(0));
    const denominations: Record<string, number> = {};
    for (const d of [500, 200, 100, 50, 20, 10, 5, 2, 1]) {
      denominations[String(d)] = Math.floor(left / d);
      left -= denominations[String(d)] * d;
    }
    await T(owner.post(`/pos/shifts/${shiftId}/close`)).send({ denominations }).expect(200);
    expect(await bal('gst_output_cgst')).toBe(cgst.neg().toFixed(2));
    expect(await bal('gst_output_sgst')).toBe(sgst.neg().toFixed(2));
    expect(await bal('gst_output_igst')).toBe(igst.neg().toFixed(2));
    // The 8.1 bill's share: ₹25.00 each, inside those totals.
    expect(cgst.gte(25)).toBe(true);
  });
});

describe('GST invoice numbers of at most 16 characters (CGST rule 46(b))', () => {
  beforeAll(freshTill);

  it('tills number PREFIX/2627/000001; a till made before keeps its old numbers until it loads its saved copy; prefixes are unique', async () => {
    const t1 = (await owner.get(`/pos/tills/${tillId}`).expect(200)).body;
    expect(t1.numberPrefix).toBe('MAT1');
    const shirt = await item('Cotton Shirt', '62052000', '1050');
    // A till set up before GST-length numbers (old series STORE-TILL).
    await prisma.till.update({ where: { id: tillId }, data: { seriesKind: 'MAIN-T1' } });
    const offlineOld = { ...sale([{ itemId: shirt.id, quantity: '1' }], '1050'), offline: true, shiftClientId, sale: { number: 'MAIN-T1-2026-27-000001', lines: [{ lineNo: 1, itemId: shirt.id, quantity: '1' }] } };
    expect((await T(owner.post('/pos/bills')).send(offlineOld).expect(201)).body.sale.number).toBe('MAIN-T1-2026-27-000001');
    // Loading the saved copy gives it the short prefix; its numbers start again in the new series.
    const snap = (await owner.get(`/pos/till/${tillId}/snapshot`).set('x-till-token', tillToken).expect(200)).body;
    expect(snap.till.numberPrefix).toBe('MAT1');
    expect(snap.lastNumbers.find((x: { financialYear: string }) => x.financialYear === '2026-27')).toMatchObject({ prefix: 'MAT1/2627/', lastNumber: null });
    const online = (await T(owner.post('/pos/bills')).send({ ...sale([{ itemId: shirt.id, quantity: '1' }], '1050'), sale: { number: 'MAT1/2627/000001', lines: [{ lineNo: 1, itemId: shirt.id, quantity: '1' }] } }).expect(201)).body.sale;
    expect(online.number).toBe('MAT1/2627/000001');
    // Online, an old-style number is refused; offline (made before the switch) it is kept.
    const late = { ...sale([{ itemId: shirt.id, quantity: '1' }], '1050'), sale: { number: 'MAIN-T1-2026-27-000002', lines: [{ lineNo: 1, itemId: shirt.id, quantity: '1' }] } };
    expect((await T(owner.post('/pos/bills')).send(late).expect(400)).body.message).toMatch(/not in this till’s series \(MAT1\/2627\/000001\)/);
    // A second till of the store gets its own prefix; a prefix in use is refused.
    const t2 = (await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T2', name: 'Counter 2', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] }).expect(201)).body;
    expect(t2.numberPrefix).toBe('MAT2');
    await owner.patch(`/pos/tills/${t2.id}`).send({ numberPrefix: 'MAT1' }).expect(409);
    expect((await owner.patch(`/pos/tills/${t2.id}`).send({ numberPrefix: 'C2' }).expect(200)).body.numberPrefix).toBe('C2');
    await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T3', name: 'Counter 3', numberPrefix: 'C2', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] }).expect(409);
  });

  it('a transfer between GSTINs is invoiced under a number of at most 16 characters', async () => {
    const series = await prisma.numberSeries.findFirstOrThrow({ where: { documentKind: 'stock_transfer_send' } });
    expect(series.pattern).toBe('TRS/{FYS}/');
  });
});

describe('8.6 composition scheme', () => {
  let shirt: { id: string };
  beforeAll(async () => {
    await freshTill();
    shirt = await item('Cotton Shirt', '62052000', '1050');
    await owner.patch('/gst/settings').send({ scheme: 'composition' }).expect(200);
  });

  it('the same sale is a bill of supply with the declaration and no tax', async () => {
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050', { buyer: { gstin: KA_GSTIN, name: 'Kaveri Traders', address: 'Bengaluru' } })).expect(201)).body;
    expect(res.sale).toMatchObject({ invoiceKind: 'bill_of_supply', documentTitle: 'Bill of supply', taxableAmount: '1050.00', cgst: '0.00', sgst: '0.00', igst: '0.00', total: '1050.00' });
    expect(res.sale.lines[0]).toMatchObject({ gstRate: '0', cgst: '0.00' });
    expect(res.receipts[0].gst).toMatchObject({ title: 'Bill of supply', declaration: 'Composition taxable person, not eligible to collect tax on supplies' });
    expect(res.receipts[0].gstTable).toEqual([]);
    const a4 = (await owner.get(`/print/pos_bill/${res.sale.id}`).expect(200)).body;
    expect(a4.title).toBe('Bill of supply');
    expect(a4.details[0]).toEqual(['Declaration', 'Composition taxable person, not eligible to collect tax on supplies']);
    expect(a4.columns.map((c: { key: string }) => c.key)).not.toContain('cgst');
    expect(a4.totals.map((t: string[]) => t[0])).toEqual(['Value', 'Total']);
  });
});

describe('8.11 GST settings and rates apply as soon as they are saved (owner decision, 22 Oct 2026)', () => {
  let shirt: { id: string };
  beforeAll(async () => {
    await freshTill();
    shirt = await item('Cotton Shirt', '62052000', '1050');
  });

  it('the settings have their defaults and no approval step; a bill is never provisional', async () => {
    const settings = (await owner.get('/gst/settings').expect(200)).body;
    expect(settings).toMatchObject({ scheme: 'regular', filingFrequency: 'quarterly', turnoverBand: 'up_to_5cr', hsnDigits: 4, eInvoiceApplies: false, combineSmallSales: true, receiptTaxTable: true, eWayLimit: '50000.00' });
    expect(settings).not.toHaveProperty('approved');
    // The approval endpoints are gone.
    await owner.post('/gst/settings/approve').send({ note: 'ok' }).expect(404);
    await owner.post('/gst/settings/withdraw-approval').send({ reason: 'x' }).expect(404);
    const b1 = (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050')).expect(201)).body;
    expect(b1.sale.gstProvisional).toBe(false);
    expect(b1.sale.checkFlags).not.toContain('gst_provisional');
    expect(b1.receipts[0].provisional).toBe(false);
  });

  it('a till bill using a newly added rate is real GST at once: not provisional, no flag', async () => {
    const rate = (await owner.post('/pos/gst-rates').send({ hsnCode: '4202', rate: '18', effectiveFrom: '2026-04-01' }).expect(201)).body;
    expect(rate).not.toHaveProperty('approved');
    await owner.post(`/pos/gst-rates/${rate.id}/approve`).expect(404);
    const bag = await item('Leather Bag', '42022110', '1180');
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: bag.id, quantity: '1' }], '1180')).expect(201)).body;
    expect(res.sale).toMatchObject({ gstProvisional: false, taxableAmount: '1000.00', cgst: '90.00', sgst: '90.00' });
    expect(res.sale.lines[0].gstRate).toBe('18');
    expect(res.sale.checkFlags).not.toContain('gst_provisional');
    expect((await prisma.posBill.findUniqueOrThrow({ where: { id: res.sale.id } })).gstProvisional).toBe(false);
  });

  it('a GST rate can be edited; the edit is in the history and saved bills keep their own rate', async () => {
    const rate = (await owner.post('/pos/gst-rates').send({ hsnCode: '9503', rate: '12', effectiveFrom: '2026-04-01' }).expect(201)).body;
    const toy = await item('Toy Car', '95030010', '112');
    const before = (await T(owner.post('/pos/bills')).send(sale([{ itemId: toy.id, quantity: '1' }], '112')).expect(201)).body.sale;
    expect(before.lines[0].gstRate).toBe('12');

    // Only someone with the rate-list right may change it.
    await owner.post('/users').send({ firstName: 'Meena', email: 'meena@rademics.test', temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, 'cashier')], storeIds: [MAIN] }).expect(201);
    const cashier = await login(app, 'meena@rademics.test', 'Temp-pass-1234');
    await cashier.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
    await cashier.patch(`/pos/gst-rates/${rate.id}`).send({ rate: '5' }).expect(403);

    const changed = (await owner.patch(`/pos/gst-rates/${rate.id}`).send({ rate: '5', note: 'Corrected rate' }).expect(200)).body;
    expect(changed).toMatchObject({ rate: '5', note: 'Corrected rate' });
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'gst_rate', entityId: rate.id, action: 'update' }, orderBy: { at: 'desc' } });
    expect(audit?.changes).toMatchObject({ rate: { old: '12', new: '5' }, note: { old: null, new: 'Corrected rate' } });

    const after = (await T(owner.post('/pos/bills')).send(sale([{ itemId: toy.id, quantity: '1' }], '112')).expect(201)).body.sale;
    expect(after).toMatchObject({ gstProvisional: false, taxableAmount: '106.67' });
    expect(after.lines[0].gstRate).toBe('5');
    // The bill saved before the change keeps the 12% it was made with.
    expect((await owner.get(`/pos/bills/${before.id}`).expect(200)).body.lines[0].gstRate).toBe('12');
  });

  it('the Owner switches the tills live without any GST approval; nobody else can', async () => {
    await owner.post('/users').send({ firstName: 'Arun', email: 'arun@rademics.test', temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, 'accountant')], storeIds: [MAIN] }).expect(201);
    const accountant = await login(app, 'arun@rademics.test', 'Temp-pass-1234');
    await accountant.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
    await accountant.patch('/pos/settings').send({ liveAllowed: true }).expect(403);
    expect((await owner.patch('/pos/settings').send({ liveAllowed: true }).expect(200)).body.liveAllowed).toBe(true);
    const b = (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], '1050')).expect(201)).body.sale;
    expect(b.gstProvisional).toBe(false);
  });

  it('the rate list keeps price bands apart and refuses overlaps', async () => {
    await owner.post('/pos/gst-rates').send({ hsnCode: '6403', rate: '5', priceUpTo: '2500', effectiveFrom: '2026-10-01' }).expect(201);
    expect((await owner.post('/pos/gst-rates').send({ hsnCode: '6403', rate: '18', priceFrom: '2000', effectiveFrom: '2026-10-01' }).expect(400)).body.message).toMatch(/overlap/);
    await owner.post('/pos/gst-rates').send({ hsnCode: '6403', rate: '18', priceFrom: '2500', effectiveFrom: '2026-10-01' }).expect(201);
    await owner.post('/pos/gst-rates').send({ hsnCode: '6403', rate: '12', effectiveFrom: '2026-10-01' }).expect(409);
    await owner.post('/pos/gst-rates').send({ hsnCode: '0401', rate: '5', kind: 'exempt', effectiveFrom: '2026-10-01' }).expect(400);
    const nil = (await owner.post('/pos/gst-rates').send({ hsnCode: '0401', rate: '0', kind: 'nil', effectiveFrom: '2026-10-01' }).expect(201)).body;
    expect(nil).toMatchObject({ kind: 'nil', rate: '0' });
  });
});
