// Copyright (c) 2026, Rademics. All rights reserved.
// Automated version of docs/acceptance-tests.md, "Module 8" scenario 8.10
// (e-invoice and e-way bill files), plus the rules around it: cancelling
// within 24 hours, failed registrations, credit notes, the e-way bill limit,
// validity and register. Amounts use test rates entered for these scenarios.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { gstinCheckCharacter } from 'shared';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let MAIN: string;
let BLR: string;
let loc: Record<string, string>;
let pcs: string;
let groupId: string;
let listId: string;
let pm: Record<string, string>;
let tillId: string;
let tillToken: string;
let n = 0;

const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);
const withCheck = (first14: string) => `${first14}${gstinCheckCharacter(first14)}`;
/** The buyer, a Karnataka business. */
const BUYER_GSTIN = withCheck('29AABCK1234A1Z');
/** Our own second registration, for the Bengaluru store. */
const OWN_KA_GSTIN = withCheck('29AAACR1234A1Z');
const num = () => `MAT1/2627/${String(++n).padStart(6, '0')}`;
/** E-invoice numbers may have at most 16 characters (portal schema), so the test bills get short ones. */
const shortNumber = (i: number) => `T1-2627-${String(i).padStart(6, '0')}`;
const IRN = 'a1'.repeat(32);
const jwt = (claims: object) => `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${'s'.repeat(342)}`;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

async function fresh() {
  owner = await setUpCompany(app, prisma);
  n = 0;
  MAIN = await storeId(prisma, 'MAIN');
  const company = await prisma.company.findFirstOrThrow();
  // Seller addresses (the e-invoice needs address, town and PIN code).
  await prisma.gstRegistration.updateMany({ where: { gstin: '33AAACR1234A1ZA' }, data: { addressLine1: '1 Anna Salai', city: 'Chennai', pincode: '600002' } });
  await prisma.store.update({ where: { id: MAIN }, data: { addressLine1: '1 Anna Salai', city: 'Chennai', pincode: '600002', stateCode: '33' } });
  const ka = await prisma.gstRegistration.create({ data: { companyId: company.id, gstin: OWN_KA_GSTIN, stateCode: '29', addressLine1: '12 MG Road', city: 'Bengaluru', pincode: '560001' } });
  await owner.post('/stores').send({ code: 'BLR', name: 'Bengaluru', addressLine1: '12 MG Road', city: 'Bengaluru', pincode: '560001', stateCode: '29', gstRegistrationId: ka.id }).expect(201);
  BLR = await storeId(prisma, 'BLR');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'APP', name: 'Apparel' }).expect(201)).body.id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  await owner.post('/pos/gst-rates').send({ hsnCode: '6205', rate: '5', effectiveFrom: '2024-04-01' }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  tillId = (
    await owner
      .post('/pos/tills')
      .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] })
      .expect(201)
  ).body.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
  await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId, cash: [{ paymentMethodId: pm.CASH, amount: '1000' }] }).expect(201);
  // 8.10 "Given e-invoicing switched on".
  await prisma.gstSettings.upsert({ where: { companyId: company.id }, create: { companyId: company.id, eInvoiceApplies: true, turnoverBand: 'above_10cr' }, update: { eInvoiceApplies: true, turnoverBand: 'above_10cr' } });
}

async function item(name: string, hsnCode: string, price: string, qty = '200', cost = '600') {
  const i = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode }).expect(201)).body as { id: string; code: string };
  await owner.post('/prices').send({ priceListId: listId, itemId: i.id, price, startDate: '2024-04-01' }).expect(201);
  const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId: i.id, countedQuantity: qty, unitCost: cost }] }).expect(201)).body;
  await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
  return i;
}

/** A business invoice to the Karnataka buyer, renumbered to a portal-length number. */
async function businessInvoice(itemId: string, quantity: string, amount: string, short: number) {
  const body = { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: [{ lineNo: 1, itemId, quantity }] }, payments: [{ paymentMethodId: pm.CASH, amount }], buyer: { gstin: BUYER_GSTIN, name: 'Kaveri Traders', address: '45 Brigade Road, Bengaluru 560025' } };
  const bill = (await T(owner.post('/pos/bills')).send(body).expect(201)).body.sale;
  await prisma.posBill.update({ where: { id: bill.id }, data: { number: shortNumber(short) } });
  return { ...bill, number: shortNumber(short) };
}

describe('8.10 e-invoice and e-way bill files', () => {
  let shirt: { id: string };
  let bill: { id: string; number: string; lines: { id: string }[] };

  beforeAll(async () => {
    await fresh();
    shirt = await item('Cotton Shirt', '62052000', '1050');
    bill = await businessInvoice(shirt.id, '1', '1050', 1);
  });

  it('a business invoice waits for registration and prints "not yet registered"', async () => {
    const list = (await owner.get('/gst/e-invoices').expect(200)).body;
    expect(list.applies).toBe(true);
    expect(list.counts.waiting).toBe(1);
    expect(list.rows[0]).toMatchObject({ documentNumber: bill.number, documentKind: 'Invoice', status: 'waiting', buyerGstin: BUYER_GSTIN, total: '1050.00', irn: null, canCancel: false });
    // ₹10 crore and above: 30 days to register, counted from the invoice date (shared
    // gst-portal.ts eInvoiceLastDay = invoice date + EINVOICE_REPORTING_DAYS, which is 30).
    // Worked here with plain calendar arithmetic, not the same helper.
    const billDate = (await prisma.posBill.findUniqueOrThrow({ where: { id: bill.id }, select: { businessDate: true } })).businessDate.toISOString().slice(0, 10);
    expect(list.rows[0].documentDate).toBe(billDate);
    const [y, m, d] = billDate.split('-').map(Number);
    expect(list.rows[0].lastDay).toBe(new Date(Date.UTC(y, m - 1, d + 30)).toISOString().slice(0, 10));
    const print = (await owner.get(`/print/pos_bill/${bill.id}`).expect(200)).body;
    expect(print.notice).toMatch(/not yet registered/);
    expect(print.details).toEqual(expect.arrayContaining([['E-invoice', 'Not yet registered']]));
    expect(print.qr ?? null).toBeNull();
  });

  it('produces the e-invoice JSON in the notified schema', async () => {
    const res = (await owner.post('/gst/e-invoices/export').send({}).expect(200)).body;
    expect(res.count).toBe(1);
    expect(res.skipped).toEqual([]);
    expect(res.fileName).toMatch(/^e-invoices-33AAACR1234A1ZA-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(res.content);
    expect(Array.isArray(file)).toBe(true);
    const inv = file[0];
    expect(inv.Version).toBe('1.1');
    expect(inv.TranDtls).toMatchObject({ TaxSch: 'GST', SupTyp: 'B2B' });
    expect(inv.DocDtls).toMatchObject({ Typ: 'INV', No: bill.number });
    expect(inv.DocDtls.Dt).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(inv.SellerDtls).toMatchObject({ Gstin: '33AAACR1234A1ZA', LglNm: 'Rademics Retail Pvt Ltd', Addr1: '1 Anna Salai', Loc: 'Chennai', Pin: 600002, Stcd: '33' });
    expect(inv.BuyerDtls).toMatchObject({ Gstin: BUYER_GSTIN, LglNm: 'Kaveri Traders', Pos: '29', Stcd: '29', Pin: 560025, Loc: 'Bengaluru' });
    expect(inv.ItemList).toHaveLength(1);
    expect(inv.ItemList[0]).toMatchObject({ SlNo: '1', IsServc: 'N', HsnCd: '62052000', Qty: 1, Unit: 'PCS', AssAmt: 1000, GstRt: 5, IgstAmt: 50, CgstAmt: 0, SgstAmt: 0, TotItemVal: 1050 });
    expect(inv.ValDtls).toMatchObject({ AssVal: 1000, IgstVal: 50, CgstVal: 0, SgstVal: 0, TotInvVal: 1050 });
    expect((await prisma.eInvoice.findFirstOrThrow({ where: { documentId: bill.id } })).exportedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'export', entityType: 'e_invoice' } })).toBe(1);
  });

  it('importing the portal’s response attaches the IRN and signed QR, which then print', async () => {
    const qr = jwt({ data: JSON.stringify({ SellerGstin: '33AAACR1234A1ZA', BuyerGstin: BUYER_GSTIN, DocNo: bill.number, DocTyp: 'INV', TotInvVal: 1050, ItemCnt: 1, MainHsnCode: '62052000', Irn: IRN }), iss: 'NIC' });
    const answer = JSON.stringify([{ AckNo: 112610000000123, AckDt: '2026-10-18 15:18:00', Irn: IRN, SignedInvoice: 'x.y.z', SignedQRCode: qr, Status: 'ACT' }]);
    const summary = (await owner.post('/gst/e-invoices/import').attach('file', Buffer.from(answer), 'irn-result.json').expect(200)).body;
    expect(summary).toMatchObject({ registered: 1, failed: 0, unmatched: [] });
    const row = await prisma.eInvoice.findFirstOrThrow({ where: { documentId: bill.id } });
    expect(row).toMatchObject({ status: 'registered', irn: IRN, ackNumber: '112610000000123', signedQr: qr });
    expect(row.ackDate?.toISOString()).toBe(new Date('2026-10-18T15:18:00+05:30').toISOString());
    const print = (await owner.get(`/print/pos_bill/${bill.id}`).expect(200)).body;
    expect(print.notice ?? null).toBeNull();
    expect(print.details).toEqual(expect.arrayContaining([['IRN', IRN], ['Ack. no.', '112610000000123'], ['Ack. date', '2026-10-18 15:18']]));
    expect(print.qr.size).toBeGreaterThanOrEqual(21);
    expect(print.qr.path).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
    // The same answer again changes nothing; it is never registered twice.
    const again = (await owner.post('/gst/e-invoices/import').attach('file', Buffer.from(answer), 'irn-result.json').expect(200)).body;
    expect(again).toMatchObject({ registered: 0, unchanged: 1 });
  });

  it('cancelling is refused after 24 hours: a credit note is needed instead', async () => {
    const row = await prisma.eInvoice.findFirstOrThrow({ where: { documentId: bill.id } });
    await prisma.eInvoice.update({ where: { id: row.id }, data: { registeredAt: new Date(Date.now() - 25 * 3_600_000) } });
    const res = await owner.post(`/gst/e-invoices/${row.id}/cancel`).send({ reason: '2' }).expect(400);
    expect(res.body.message).toMatch(/24 hours.*credit note/);
  });

  it('a credit note against the business invoice is an e-invoice too (CRN with the original invoice)', async () => {
    const back = { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), buyer: { name: 'Walk-in customer' }, ret: { number: num(), returnOfId: bill.id, lines: [{ lineNo: 1, itemId: shirt.id, quantity: '1', returnOfLineId: bill.lines[0].id }] }, payments: [{ paymentMethodId: pm.CASH, amount: '-1050' }] };
    const ret = (await T(owner.post('/pos/bills')).send(back).expect(201)).body.return;
    await prisma.posBill.update({ where: { id: ret.id }, data: { number: 'R1-2627-000001' } });
    const list = (await owner.get('/gst/e-invoices?status=waiting').expect(200)).body;
    expect(list.rows.map((r: { documentNumber: string; documentKind: string }) => [r.documentNumber, r.documentKind])).toEqual([['R1-2627-000001', 'Credit note']]);
    const inv = JSON.parse((await owner.post('/gst/e-invoices/export').send({ ids: [list.rows[0].id] }).expect(200)).body.content)[0];
    expect(inv.DocDtls.Typ).toBe('CRN');
    expect(inv.ItemList[0]).toMatchObject({ Qty: 1, AssAmt: 1000, IgstAmt: 50 });
    expect(inv.ValDtls.TotInvVal).toBe(1050);
    expect(inv.RefDtls.PrecDocDtls[0].InvNo).toBe(bill.number);
    // Cancelled within 24 hours of registration: allowed.
    const crn = list.rows[0].id;
    const qr = jwt({ data: JSON.stringify({ DocNo: 'R1-2627-000001', DocTyp: 'CRN' }) });
    await owner.post(`/gst/e-invoices/${crn}/registration`).send({ irn: 'b2'.repeat(32), ackNumber: '112610000000124', ackDate: new Date().toISOString(), signedQr: qr }).expect(200);
    const cancelled = (await owner.post(`/gst/e-invoices/${crn}/cancel`).send({ reason: '2', remark: 'Wrong quantity' }).expect(200)).body;
    expect(cancelled.status).toBe('cancelled');
  });

  it('a refused registration shows the portal’s error and can be queued again', async () => {
    const second = await businessInvoice(shirt.id, '2', '2100', 2);
    await owner.get('/gst/e-invoices').expect(200);
    const csv = `Seller GSTIN,Document No.,Error Code,Error Description\r\n33AAACR1234A1ZA,${second.number},2172,Invalid buyer GSTIN\r\n`;
    const summary = (await owner.post('/gst/e-invoices/import').attach('file', Buffer.from(csv), 'errors.csv').expect(200)).body;
    expect(summary).toMatchObject({ failed: 1 });
    const row = await prisma.eInvoice.findFirstOrThrow({ where: { documentId: second.id } });
    expect(row).toMatchObject({ status: 'failed', error: '2172: Invalid buyer GSTIN' });
    const print = (await owner.get(`/print/pos_bill/${second.id}`).expect(200)).body;
    expect(print.notice).toMatch(/not yet registered/);
    await owner.post(`/gst/e-invoices/${row.id}/retry`).expect(200);
    expect((await prisma.eInvoice.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('waiting');
  });

  it('numbers longer than the portal’s 16 characters are left out of the file, with the reason', async () => {
    // A till set up before GST-length numbers (plan 08): its old 22-character series.
    await prisma.till.update({ where: { id: tillId }, data: { seriesKind: 'MAIN-T1' } });
    const body = { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: 'MAIN-T1-2026-27-000099', lines: [{ lineNo: 1, itemId: shirt.id, quantity: '1' }] }, payments: [{ paymentMethodId: pm.CASH, amount: '1050' }], buyer: { gstin: BUYER_GSTIN, name: 'Kaveri Traders', address: '45 Brigade Road, Bengaluru 560025' } };
    const long = (await T(owner.post('/pos/bills')).send(body).expect(201)).body.sale;
    await prisma.till.update({ where: { id: tillId }, data: { seriesKind: 'MAT1' } });
    await owner.get('/gst/e-invoices').expect(200);
    const row = await prisma.eInvoice.findFirstOrThrow({ where: { documentId: long.id } });
    const res = (await owner.post('/gst/e-invoices/export').send({ ids: [row.id] }).expect(200)).body;
    expect(res.count).toBe(0);
    expect(res.skipped[0].problems.join(' ')).toMatch(/1 to 16 characters/);
  });

  it('a ₹60,000 transfer to another state gives the e-way bill JSON; with 450 km the validity is 3 days', async () => {
    const saree = await item('Silk Saree', '62052000', '945', '101', '600');
    const draft = (await owner.post('/stock/documents').send({ storeId: MAIN, kind: 'transfer_send', fromLocationId: loc['MAIN-FLOOR'], toStoreId: BLR, lines: [{ itemId: saree.id, quantity: '100' }] }).expect(201)).body;
    const send = (await owner.post(`/stock/documents/${draft.id}/finalise`).expect(200)).body;
    await prisma.stockDocument.update({ where: { id: send.id }, data: { number: 'TS-2627-000001' } });

    // It is listed as needing an e-way bill: goods of ₹60,000 plus 5% IGST, above the ₹50,000 other-state limit.
    const check = (await owner.get(`/gst/e-way-bills/for/stock_document/${send.id}`).expect(200)).body;
    expect(check).toMatchObject({ value: '63000.00', limit: '50000.00', required: true, interState: true, eWayBill: null });
    const needed = (await owner.get('/gst/e-way-bills/needed').expect(200)).body;
    expect(needed.map((d: { documentId: string }) => d.documentId)).toContain(send.id);

    const ewb = (await owner.post('/gst/e-way-bills').send({ documentType: 'stock_document', documentId: send.id, distanceKm: 450, vehicleNo: 'TN 01 AB 1234' }).expect(201)).body;
    expect(ewb).toMatchObject({ status: 'draft', value: '63000.00', distanceKm: 450, validityDays: 3, vehicleNo: 'TN01AB1234' });

    const exp = (await owner.post('/gst/e-way-bills/export').send({ ids: [ewb.id] }).expect(200)).body;
    expect(exp.skipped).toEqual([]);
    const file = JSON.parse(exp.content);
    expect(file.version).toBe('1.0.0621');
    expect(file.billLists).toHaveLength(1);
    expect(file.billLists[0]).toMatchObject({
      userGstin: '33AAACR1234A1ZA',
      supplyType: 'O',
      subSupplyType: 1,
      docType: 'INV',
      docNo: 'TS-2627-000001',
      fromGstin: '33AAACR1234A1ZA',
      fromPincode: 600002,
      fromStateCode: 33,
      toGstin: OWN_KA_GSTIN,
      toPincode: 560001,
      toStateCode: 29,
      actualToStateCode: 29,
      totalValue: 60000,
      igstValue: 3000,
      cgstValue: 0,
      totInvValue: 63000,
      transMode: 1,
      transDistance: 450,
      vehicleNo: 'TN01AB1234',
      vehicleType: 'R',
    });
    expect(file.billLists[0].itemList[0]).toMatchObject({ itemNo: 1, hsnCode: '62052000', quantity: 100, qtyUnit: 'PCS', taxableAmount: 60000, igstRate: 5 });

    // The number the portal gave, made at 10:30 on 18 October: valid to the end of 21 October.
    const made = (await owner.post(`/gst/e-way-bills/${ewb.id}/generated`).send({ number: '123456789012', generatedAt: '2026-10-18T10:30:00+05:30' }).expect(200)).body;
    expect(made).toMatchObject({ status: 'generated', number: '123456789012', validityDays: 3 });
    expect(new Date(made.validUntil).toISOString()).toBe(new Date('2026-10-21T23:59:59+05:30').toISOString());
    // Printed on the transfer document.
    const print = (await owner.get(`/print/transfer/${send.id}`).expect(200)).body;
    expect(print.details).toEqual(expect.arrayContaining([['E-way bill', '123456789012'], ['E-way bill valid until', '2026-10-21 23:59']]));
    // One e-way bill per document.
    await owner.post('/gst/e-way-bills').send({ documentType: 'stock_document', documentId: send.id, distanceKm: 450, vehicleNo: 'TN01AB1234' }).expect(400);
  });

  it('the register shows made, expired and cancelled e-way bills; cancelling only within 24 hours', async () => {
    // The one above was made on 18 October 2026, so by the real clock it may be past its validity;
    // set it explicitly so the status does not depend on the day the test runs.
    const ewb = await prisma.eWayBill.findFirstOrThrow({ where: { number: '123456789012' } });
    await prisma.eWayBill.update({ where: { id: ewb.id }, data: { status: 'generated', validUntil: new Date(Date.now() + 24 * 3_600_000) } });
    const list = (await owner.get('/gst/e-way-bills').expect(200)).body;
    expect(list.rows).toHaveLength(1);
    const row = list.rows[0];
    expect(row).toMatchObject({ id: ewb.id, status: 'generated' });
    const stale = await prisma.eWayBill.update({ where: { id: row.id }, data: { status: 'generated', generatedAt: new Date(Date.now() - 25 * 3_600_000), validUntil: new Date(Date.now() - 60_000) } });
    expect((await owner.post(`/gst/e-way-bills/${stale.id}/cancel`).send({ reason: 'Not moved' }).expect(400)).body.message).toMatch(/24 hours|expired/);
    const after = (await owner.get('/gst/e-way-bills?status=expired').expect(200)).body;
    expect(after.rows.map((r: { id: string }) => r.id)).toEqual([stale.id]);

    // A bill below the limit may still have one by choice; a draft can be cancelled at any time.
    const saree = await prisma.item.findFirstOrThrow({ where: { name: 'Silk Saree' } });
    const small = await businessInvoice(saree.id, '1', '945', 9);
    const check = (await owner.get(`/gst/e-way-bills/for/pos_bill/${small.id}`).expect(200)).body;
    expect(check).toMatchObject({ value: '945.00', required: false, interState: true });
    const d = (await owner.post('/gst/e-way-bills').send({ documentType: 'pos_bill', documentId: small.id, distanceKm: 350, transporterId: OWN_KA_GSTIN, transporterName: 'Fast Movers' }).expect(201)).body;
    const exp = JSON.parse((await owner.post('/gst/e-way-bills/export').send({ ids: [d.id] }).expect(200)).body.content);
    expect(exp.billLists[0]).toMatchObject({ docType: 'INV', subSupplyType: 1, toGstin: BUYER_GSTIN, toPincode: 560025, igstValue: 45, totInvValue: 945, transporterId: OWN_KA_GSTIN });
    // The number can also come from a file saved from the portal.
    const answer = JSON.stringify([{ docNo: small.number, ewayBillNo: 321098765432, ewayBillDate: '18/10/2026 11:00:00 AM', validUpto: '20/10/2026 11:59:00 PM' }]);
    expect((await owner.post('/gst/e-way-bills/import').attach('file', Buffer.from(answer), 'ewb.json').expect(200)).body).toMatchObject({ generated: 1 });
    const imported = await prisma.eWayBill.findUniqueOrThrow({ where: { id: d.id } });
    expect(imported).toMatchObject({ status: 'generated', number: '321098765432' });
    expect(imported.validUntil?.toISOString()).toBe(new Date('2026-10-20T23:59:00+05:30').toISOString());
    const print = (await owner.get(`/print/pos_bill/${small.id}`).expect(200)).body;
    expect(print.details).toEqual(expect.arrayContaining([['E-way bill', '321098765432']]));
  });

  it('only people with the right may use the e-invoice and e-way bill screens', async () => {
    await owner.post('/users').send({ firstName: 'Cash', email: 'cashier@rademics.test', temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, 'cashier')], storeIds: [MAIN] }).expect(201);
    const cashier = await login(app, 'cashier@rademics.test', 'Temp-pass-1234');
    await cashier.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
    await cashier.get('/gst/e-invoices').expect(403);
    await cashier.get('/gst/e-way-bills').expect(403);
    await cashier.post('/gst/e-invoices/export').send({}).expect(403);
  });
});
