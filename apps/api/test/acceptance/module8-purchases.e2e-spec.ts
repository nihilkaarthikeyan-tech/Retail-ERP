// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 8", the
// purchase side: 8.7 reverse charge and blocked credit, 8.6 composition
// purchases, transfers between GSTINs (G10), the purchase tax register and
// input-credit matching against the portal's GSTR-2B statement.
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { businessDate, Decimal, gstinCheckCharacter } from 'shared';
import { AccountingSetup } from '../../src/ledger/accounting-setup.service.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: SystemPrisma;
let owner: Agent;
let MAIN: string;
let ANNA: string;
let BLR: string;
let loc: Record<string, string>;
let pcs: string;
let groupId: string;
let terms: Record<string, string>;
let supplierGroups: Record<string, string>;
let mainRegId: string;
let blrRegId: string;

const today = () => businessDate();
const period = () => today().slice(0, 7);
/** A GSTIN with its correct check character. */
const gstin = (first14: string) => `${first14}${gstinCheckCharacter(first14)}`;
const MAIN_GSTIN = '33AAACR1234A1ZV';
const BLR_GSTIN = gstin('29AAACR1234A1Z');

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

async function freshCompany() {
  owner = await setUpCompany(app, prisma);
  MAIN = await storeId(prisma, 'MAIN');
  mainRegId = (await prisma.gstRegistration.findFirstOrThrow({ where: { gstin: MAIN_GSTIN } })).id;
  blrRegId = (await owner.post('/company/gst-registrations').send({ gstin: BLR_GSTIN, city: 'Bengaluru' }).expect(201)).body.id;
  await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201);
  await owner.post('/stores').send({ code: 'BLR', name: 'Bengaluru', gstRegistrationId: blrRegId }).expect(201);
  ANNA = await storeId(prisma, 'ANNA');
  BLR = await storeId(prisma, 'BLR');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'CLOTH', name: 'Clothing' }).expect(201)).body.id;
  terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
  supplierGroups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
  for (const [hsnCode, rate] of [['6205', '5'], ['9965', '18'], ['6109', '18']]) await owner.post('/pos/gst-rates').send({ hsnCode, rate, effectiveFrom: '2026-04-01' }).expect(201);
}

async function item(name: string, hsnCode: string, extra: Record<string, unknown> = {}) {
  return (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode, ...extra }).expect(201)).body as { id: string; code: string };
}

async function supplier(name: string, extra: Record<string, unknown> = {}) {
  return (await owner.post('/suppliers').send({ name, supplierGroupId: supplierGroups.DISTRIBUTORS, paymentTermsId: terms.NET30, ...extra }).expect(201)).body as { id: string; code: string };
}

async function opening(itemId: string, qty: string, cost: string, location = 'MAIN-FLOOR', store = MAIN) {
  const count = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: store, locationId: loc[location], lines: [{ itemId, countedQuantity: qty, unitCost: cost }] }).expect(201)).body;
  await owner.post(`/stock/documents/${count.id}/finalise`).expect(200);
}

async function position(itemId: string, code: string) {
  const p = await prisma.stockPosition.findUnique({ where: { itemId_locationId: { itemId, locationId: loc[code] } } });
  return { q: p?.quantity.toString() ?? '0', cost: p?.unitCost.toFixed(4) ?? '0.0000', value: p?.value.toFixed(2) ?? '0.00' };
}

async function staff(firstName: string, email: string, role: string) {
  await owner.post('/users').send({ firstName, email, temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, role)], storeIds: [MAIN] }).expect(201);
  const a = await login(app, email, 'Temp-pass-1234');
  await a.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
  return a;
}

/** Debit minus credit of an account (optionally for one store), as "12.34". */
async function bal(key: string, store?: string): Promise<string> {
  const account = await prisma.account.findFirstOrThrow({ where: { systemKey: key } });
  const s = await prisma.ledgerLine.aggregate({ where: { accountId: account.id, ...(store ? { storeId: store } : {}) }, _sum: { debit: true, credit: true } });
  return new Decimal(s._sum.debit?.toString() ?? '0').sub(new Decimal(s._sum.credit?.toString() ?? '0')).toFixed(2);
}

/** After every scenario the books balance and agree with the stock records. */
async function expectBooks() {
  const health = (await owner.get('/reports/book-health').expect(200)).body;
  expect(health.problems).toEqual([]);
  expect(health.totalDebit).toBe(health.totalCredit);
  const stock = (await owner.get('/reports/stock-vs-accounts').expect(200)).body;
  expect(stock.rows.filter((r: { difference: string }) => r.difference !== '0.00')).toEqual([]);
}

async function bill(body: Record<string, unknown>, expectStatus = 200) {
  const draft = (await owner.post('/purchase/bills').send({ supplierBillDate: today(), ...body }).expect(201)).body;
  const res = await owner.post(`/purchase/bills/${draft.id}/finalise`).send({}).expect(expectStatus);
  return res.body;
}

async function receipt(supplierId: string, lines: Record<string, unknown>[]) {
  const draft = (await owner.post('/purchase/receipts').send({ storeId: MAIN, supplierId, noOrderReason: 'Test', lines }).expect(201)).body;
  return (await owner.post(`/purchase/receipts/${draft.id}/finalise`).expect(200)).body;
}

describe('8.7 reverse charge and blocked credit on purchases', () => {
  beforeAll(freshCompany);
  afterAll(expectBooks);

  it('a company whose chart was made before module 8 gets the reverse-charge accounts from the chart check', async () => {
    const setup = app.get(AccountingSetup);
    const companyId = (await prisma.company.findFirstOrThrow()).id;
    await setup.ensure(prisma, companyId);
    const keys = ['gst_rcm_cgst', 'gst_rcm_sgst', 'gst_rcm_igst'];
    // As the chart was before this module: no reverse-charge accounts.
    await prisma.accountDefault.deleteMany({ where: { companyId, role: { in: keys } } });
    await prisma.account.deleteMany({ where: { companyId, systemKey: { in: keys } } });
    await setup.ensure(prisma, companyId);
    for (const key of keys) {
      const account = await prisma.account.findFirstOrThrow({ where: { systemKey: key } });
      expect(account.kind).toBe('tax');
      expect(await prisma.accountDefault.findFirst({ where: { role: key } })).not.toBeNull();
    }
  });

  it('a reverse-charge purchase bill of ₹10,000 at 18% posts ₹1,800.00 payable by the shop and ₹1,800.00 input credit', async () => {
    const legal = await item('Legal services', '9965', { isStockItem: false });
    const advocate = await supplier('K. Raman, Advocate', { stateCode: '33', taxSituation: 'reverse_charge' });
    const b = await bill({ kind: 'services', supplierId: advocate.id, supplierBillNo: 'KR/7', storeId: MAIN, lines: [{ itemId: legal.id, quantity: '1', rate: '10000', gstRate: '18' }] });
    expect(b).toMatchObject({ status: 'unpaid', reverseCharge: true, placeOfSupply: '33', gstRegistrationId: mainRegId, taxableAmount: '10000.00', taxAmount: '1800.00', total: '10000.00' });
    expect(b.lines[0]).toMatchObject({ cgst: '900.00', sgst: '900.00', igst: '0.00', lineTotal: '10000.00', creditClaimable: true, hsnCode: '9965' });
    expect(await bal('gst_rcm_cgst')).toBe('-900.00');
    expect(await bal('gst_rcm_sgst')).toBe('-900.00');
    expect(await bal('gst_input_cgst')).toBe('900.00');
    expect(await bal('gst_input_sgst')).toBe('900.00');
    expect(await bal('supplier_payable')).toBe('-10000.00');
    expect(await bal('purchase_expense')).toBe('10000.00');
  });

  it('a bill can be marked reverse charge for a regular supplier; cancelling takes everything back', async () => {
    const legal = await item('Transport by road', '9965', { isStockItem: false });
    const gta = await supplier('Lakshmi Transport', { gstin: gstin('33AABCL1234B1Z'), stateCode: '33' });
    const before = { rcm: await bal('gst_rcm_cgst'), pay: await bal('supplier_payable') };
    const b = await bill({ kind: 'services', supplierId: gta.id, supplierBillNo: 'LT/55', storeId: MAIN, reverseCharge: true, lines: [{ itemId: legal.id, quantity: '1', rate: '1000', gstRate: '18' }] });
    expect(b).toMatchObject({ reverseCharge: true, total: '1000.00', taxAmount: '180.00' });
    expect(await bal('gst_rcm_cgst')).toBe(new Decimal(before.rcm).sub(90).toFixed(2));
    await owner.post(`/purchase/bills/${b.id}/cancel`).send({ reason: 'Entered twice' }).expect(200);
    expect(await bal('gst_rcm_cgst')).toBe(before.rcm);
    expect(await bal('supplier_payable')).toBe(before.pay);
  });

  it('a supplier in another state is charged IGST; the bill records the place of supply and HSN per line', async () => {
    const shirt = await item('Linen shirt', '6205');
    const ktk = await supplier('Mysore Mills', { gstin: gstin('29AAACM5678C1Z') });
    const b = await bill({ kind: 'receives_goods', supplierId: ktk.id, supplierBillNo: 'MM/1', storeId: MAIN, lines: [{ itemId: shirt.id, quantity: '10', rate: '400', gstRate: '5', shelfLocationId: loc['MAIN-FLOOR'] }] });
    expect(b).toMatchObject({ placeOfSupply: '33', reverseCharge: false, total: '4200.00' });
    expect(b.lines[0]).toMatchObject({ igst: '200.00', cgst: '0.00', hsnCode: '6205', creditClaimable: true });
    // A bill that receives the goods puts them in stock once (at ₹400 each, before GST).
    expect(await position(shirt.id, 'MAIN-FLOOR')).toEqual({ q: '10', cost: '400.0000', value: '4000.00' });
    expect(await bal('goods_received_not_billed')).toBe('0.00');
  });

  it('a line marked "credit not claimable" adds its tax to the cost of the goods (bill that receives them)', async () => {
    const tee = await item('Gift T-shirt', '6109');
    const s = await supplier('Tiruppur Knits', { gstin: gstin('33AACCT1234D1Z'), stateCode: '33' });
    const inputBefore = await bal('gst_input_cgst');
    const b = await bill({ kind: 'receives_goods', supplierId: s.id, supplierBillNo: 'TK/9', storeId: MAIN, lines: [{ itemId: tee.id, quantity: '10', rate: '1000', gstRate: '18', creditClaimable: false, shelfLocationId: loc['MAIN-FLOOR'] }] });
    expect(b.lines[0]).toMatchObject({ creditClaimable: false, cgst: '900.00', sgst: '900.00' });
    expect(b.total).toBe('11800.00');
    expect(await position(tee.id, 'MAIN-FLOOR')).toEqual({ q: '10', cost: '1180.0000', value: '11800.00' });
    expect(await bal('gst_input_cgst')).toBe(inputBefore);
    expect(await bal('goods_received_not_billed')).toBe('0.00');
  });

  it('against an earlier receipt, the tax is added to the cost and goods already written off are re-costed; cancelling the bill takes it out again', async () => {
    const kurta = await item('Cotton kurta', '6205');
    const s = await supplier('Erode Weavers', { gstin: gstin('33AADCE1234E1Z'), stateCode: '33' });
    const r = await receipt(s.id, [{ itemId: kurta.id, receivedQuantity: '10', rate: '500', gstRate: '5' }]);
    // Two are damaged before the bill arrives.
    const out = (await owner.post('/stock/documents').send({ storeId: MAIN, kind: 'stock_out', reason: 'damage', fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: kurta.id, quantity: '2' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${out.id}/finalise`).expect(200);
    const writeOffBefore = await bal('write_off');
    const b = await bill({ kind: 'against_receipt', supplierId: s.id, supplierBillNo: 'EW/31', lines: [{ receiptLineId: r.lines[0].id, itemId: kurta.id, quantity: '10', creditClaimable: false }] });
    expect(b.lines[0]).toMatchObject({ creditClaimable: false, cgst: '125.00', sgst: '125.00' });
    expect(await position(kurta.id, 'MAIN-FLOOR')).toEqual({ q: '8', cost: '525.0000', value: '4200.00' });
    expect(await bal('write_off')).toBe(new Decimal(writeOffBefore).add(50).toFixed(2));
    expect(await bal('goods_received_not_billed')).toBe('0.00');
    expect((await prisma.goodsReceiptLine.findUniqueOrThrow({ where: { id: r.lines[0].id } })).unitCost.toFixed(4)).toBe('525.0000');

    await owner.post(`/purchase/bills/${b.id}/cancel`).send({ reason: 'Wrong flag' }).expect(200);
    expect(await position(kurta.id, 'MAIN-FLOOR')).toEqual({ q: '8', cost: '500.0000', value: '4000.00' });
    expect(await bal('write_off')).toBe(writeOffBefore);
    expect(await bal('goods_received_not_billed')).toBe('-5000.00');
    // Billed again correctly: input credit this time.
    const again = await bill({ kind: 'against_receipt', supplierId: s.id, supplierBillNo: 'EW/31', lines: [{ receiptLineId: r.lines[0].id, itemId: kurta.id, quantity: '10' }] });
    expect(again.lines[0].creditClaimable).toBe(true);
    expect(await bal('goods_received_not_billed')).toBe('0.00');
  });

  it('a debit note keeps the reverse charge and the credit flag of its bill', async () => {
    const tee = await item('Promo T-shirt', '6109');
    const s = await supplier('Salem Prints', { gstin: gstin('33AAECS1234F1Z'), stateCode: '33' });
    const b = await bill({ kind: 'receives_goods', supplierId: s.id, supplierBillNo: 'SP/4', storeId: MAIN, lines: [{ itemId: tee.id, quantity: '4', rate: '100', gstRate: '18', creditClaimable: false, shelfLocationId: loc['MAIN-FLOOR'] }] });
    expect(await position(tee.id, 'MAIN-FLOOR')).toEqual({ q: '4', cost: '118.0000', value: '472.00' });
    const note = (await owner.post(`/purchase/bills/${b.id}/debit-note`).send({ reason: 'Damaged', lines: [{ originalLineId: b.lines[0].id, quantity: '1' }] }).expect(201)).body;
    expect(note.lines[0]).toMatchObject({ creditClaimable: false, quantity: '-1' });
    expect(note.total).toBe('-118.00');
    expect(await position(tee.id, 'MAIN-FLOOR')).toEqual({ q: '3', cost: '118.0000', value: '354.00' });
    expect(await bal('goods_received_not_billed')).toBe('0.00');
  });
});

describe('8.6 composition scheme: purchase tax goes into the cost, no input credit', () => {
  beforeAll(async () => {
    await freshCompany();
    await prisma.gstSettings.upsert({ where: { companyId: (await prisma.company.findFirstOrThrow()).id }, create: { companyId: (await prisma.company.findFirstOrThrow()).id, scheme: 'composition' }, update: { scheme: 'composition' } });
  });
  afterAll(expectBooks);

  it('every line is "credit not claimable" and the stock carries the tax', async () => {
    const shirt = await item('Checked shirt', '6205');
    const s = await supplier('Coimbatore Garments', { gstin: gstin('33AAFCC1234G1Z'), stateCode: '33' });
    const b = await bill({ kind: 'receives_goods', supplierId: s.id, supplierBillNo: 'CG/1', storeId: MAIN, lines: [{ itemId: shirt.id, quantity: '20', rate: '300', gstRate: '5', creditClaimable: true, shelfLocationId: loc['MAIN-FLOOR'] }] });
    expect(b.lines[0]).toMatchObject({ creditClaimable: false, cgst: '150.00', sgst: '150.00' });
    expect(await position(shirt.id, 'MAIN-FLOOR')).toEqual({ q: '20', cost: '315.0000', value: '6300.00' });
    expect(await bal('gst_input_cgst')).toBe('0.00');
    expect(await bal('gst_input_sgst')).toBe('0.00');
    expect(await bal('supplier_payable')).toBe('-6300.00');
  });

  it('a services bill puts the tax into the expense', async () => {
    const svc = await item('Shop cleaning', '9965', { isStockItem: false });
    const s = await supplier('Clean Co', { gstin: gstin('33AAGCC1234H1Z'), stateCode: '33' });
    const expenseBefore = await bal('purchase_expense');
    await bill({ kind: 'services', supplierId: s.id, supplierBillNo: 'CC/1', storeId: MAIN, lines: [{ itemId: svc.id, quantity: '1', rate: '1000', gstRate: '18' }] });
    expect(await bal('purchase_expense')).toBe(new Decimal(expenseBefore).add(1180).toFixed(2));
    expect(await bal('gst_input_cgst')).toBe('0.00');
  });
});

describe('G10 transfers: delivery challan within one GSTIN, tax invoice between GSTINs', () => {
  let shirt: { id: string; code: string };
  beforeAll(async () => {
    await freshCompany();
    shirt = await item('Formal shirt', '6205');
    await opening(shirt.id, '50', '500');
  });
  afterAll(expectBooks);

  async function send(toStoreId: string, quantity: string) {
    const draft = (await owner.post('/stock/documents').send({ storeId: MAIN, kind: 'transfer_send', fromLocationId: loc['MAIN-FLOOR'], toStoreId, lines: [{ itemId: shirt.id, quantity }] }).expect(201)).body;
    return (await owner.post(`/stock/documents/${draft.id}/finalise`).expect(200)).body;
  }

  it('a transfer inside one GSTIN prints a delivery challan and posts no tax', async () => {
    const s = await send(ANNA, '5');
    expect(await prisma.ledgerEntry.count({ where: { documentType: 'transfer_tax_invoice', documentId: s.id } })).toBe(0);
    const doc = (await owner.get(`/print/transfer/${s.id}`).expect(200)).body;
    expect(doc.title).toBe('Delivery challan');
    expect(doc.lines[0]).toMatchObject({ hsn: '6205', value: '2500.00' });
    expect(doc.details).toEqual(expect.arrayContaining([['Consignor', expect.stringContaining(MAIN_GSTIN)], ['Reason', 'Transfer between own stores (not a sale)']]));
  });

  it('a transfer to the Karnataka store is invoiced with IGST: output tax at the sender, input tax at the receiver, stock at cost', async () => {
    const s = await send(BLR, '10');
    expect(await bal('gst_output_igst', MAIN)).toBe('-250.00');
    expect(await bal('gst_input_igst', BLR)).toBe('250.00');
    expect(await position(shirt.id, 'TRANSIT')).toEqual({ q: '15', cost: '500.0000', value: '7500.00' });
    const doc = (await owner.get(`/print/transfer/${s.id}`).expect(200)).body;
    expect(doc.title).toBe('Tax invoice (stock transfer)');
    expect(doc.details).toEqual(expect.arrayContaining([['Place of supply', '29'], ['Consignee', expect.stringContaining(BLR_GSTIN)]]));
    expect(doc.lines[0]).toMatchObject({ hsn: '6205', value: '5000.00', gst: 'IGST 5% · 250.00' });
    expect(doc.totals).toEqual(expect.arrayContaining([['IGST', '250.00'], ['Total', '5250.00']]));
    // Received at cost in Bengaluru; the tax does not change the stock value.
    await owner.post(`/stock/transfers/${s.id}/receive`).send({}).expect(201);
    expect(await position(shirt.id, 'BLR-FLOOR')).toEqual({ q: '10', cost: '500.0000', value: '5000.00' });
  });

  it('cancelling an unreceived send takes the tax back', async () => {
    const s = await send(BLR, '2');
    expect(await bal('gst_output_igst', MAIN)).toBe('-300.00');
    await owner.post(`/stock/documents/${s.id}/cancel`).send({ reason: 'Not needed' }).expect(200);
    expect(await bal('gst_output_igst', MAIN)).toBe('-250.00');
    expect(await bal('gst_input_igst', BLR)).toBe('250.00');
  });

  it('an item without an HSN code cannot be sent to another GSTIN', async () => {
    const plain = await item('Loose buttons', '6205');
    await prisma.item.update({ where: { id: plain.id }, data: { hsnCode: null } });
    await opening(plain.id, '5', '10');
    const draft = (await owner.post('/stock/documents').send({ storeId: MAIN, kind: 'transfer_send', fromLocationId: loc['MAIN-FLOOR'], toStoreId: BLR, lines: [{ itemId: plain.id, quantity: '1' }] }).expect(201)).body;
    const res = await owner.post(`/stock/documents/${draft.id}/finalise`).expect(400);
    expect(res.body.message).toMatch(/no HSN code/);
    expect(await position(plain.id, 'MAIN-FLOOR')).toMatchObject({ q: '5' });
  });
});

describe('Purchase tax register and GSTR-2B matching', () => {
  let s1: { id: string };
  let s1Gstin: string;
  beforeAll(async () => {
    await freshCompany();
    const shirt = await item('Polo shirt', '6205');
    const svc = await item('Freight', '9965', { isStockItem: false });
    s1Gstin = gstin('33AAHCS1234J1Z');
    s1 = await supplier('Sri Ganesh Textiles', { gstin: s1Gstin, stateCode: '33' });
    const s2 = await supplier('Unregistered tailor', { stateCode: '33' });
    const gta = await supplier('Road Carriers', { stateCode: '33', taxSituation: 'reverse_charge' });
    // Three bills of Sri Ganesh: one matches, one differs, one is not on the portal yet.
    for (const [no, rate] of [['SGT/001', '200'], ['SGT/002', '300'], ['SGT/003', '400']]) {
      await bill({ kind: 'receives_goods', supplierId: s1.id, supplierBillNo: no, storeId: MAIN, lines: [{ itemId: shirt.id, quantity: '10', rate, gstRate: '5', shelfLocationId: loc['MAIN-FLOOR'] }] });
    }
    await bill({ kind: 'receives_goods', supplierId: s2.id, supplierBillNo: 'T/1', storeId: MAIN, lines: [{ itemId: shirt.id, quantity: '1', rate: '100', gstRate: '0', shelfLocationId: loc['MAIN-FLOOR'] }] });
    await bill({ kind: 'services', supplierId: gta.id, supplierBillNo: 'RC/9', storeId: MAIN, lines: [{ itemId: svc.id, quantity: '1', rate: '1000', gstRate: '18', creditClaimable: false }] });
  });
  afterAll(expectBooks);

  it('lists every bill of the GSTIN and period with tax per head, credit claimable and reverse charge', async () => {
    const r = (await owner.get(`/gst/purchase-register?period=${period()}`).expect(200)).body;
    expect(r.gstin).toBe(MAIN_GSTIN);
    expect(r.rows).toHaveLength(5);
    const sgt1 = r.rows.find((x: { supplierBillNo: string }) => x.supplierBillNo === 'SGT/001');
    expect(sgt1).toMatchObject({ supplierGstin: s1Gstin, taxable: '2000.00', cgst: '50.00', sgst: '50.00', igst: '0.00', creditClaimable: '100.00', creditNotClaimable: '0.00', reverseCharge: false, placeOfSupply: '33', rates: '5%' });
    const rc = r.rows.find((x: { supplierBillNo: string }) => x.supplierBillNo === 'RC/9');
    expect(rc).toMatchObject({ reverseCharge: true, tax: '180.00', creditClaimable: '0.00', creditNotClaimable: '180.00', total: '1000.00', supplierGstin: null });
    expect(r.totals).toMatchObject({ taxable: '10100.00', tax: '630.00', creditClaimable: '450.00', creditNotClaimable: '180.00', reverseChargeTax: '180.00' });
    // The Karnataka registration has no purchases.
    expect((await owner.get(`/gst/purchase-register?period=${period()}&gstRegistrationId=${blrRegId}`).expect(200)).body.rows).toEqual([]);
  });

  it('downloads as Excel and CSV', async () => {
    const x = await owner.get(`/gst/purchase-register?period=${period()}&format=xlsx`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(x.headers['content-disposition']).toContain(`purchase-tax-register-${MAIN_GSTIN}`);
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const csv = await owner.get(`/gst/purchase-register?period=${period()}&format=csv`).expect(200);
    expect(csv.text).toContain('SGT/002');
    expect(await prisma.auditLog.count({ where: { action: 'export', entityType: 'purchase_tax_register' } })).toBe(2);
  });

  it('matches the portal statement: matched, amounts differ, only on the portal, only in our books', async () => {
    const [y, m] = period().split('-');
    const dmy = `${today().slice(8, 10)}-${m}-${y}`;
    const statement = {
      chksum: 'x',
      data: {
        gstin: MAIN_GSTIN,
        rtnprd: `${m}${y}`,
        version: '1.0',
        gendt: dmy,
        docdata: {
          b2b: [
            {
              ctin: s1Gstin,
              trdnm: 'SRI GANESH TEXTILES',
              supfildt: dmy,
              supprd: `${m}${y}`,
              inv: [
                // Typed as "sgt-1" by the supplier: still the same bill.
                { inum: 'sgt-1', typ: 'R', dt: dmy, val: 2100, pos: '33', rev: 'N', itcavl: 'Y', rsn: '', diffprcnt: 1, srctyp: '', irn: '', irngendate: '', txval: 2000, igst: 0, cgst: 50, sgst: 50, cess: 0 },
                { inum: 'SGT/002', typ: 'R', dt: dmy, val: 3360, pos: '33', rev: 'N', itcavl: 'Y', txval: 3200, igst: 0, cgst: 80, sgst: 80, cess: 0 },
                { inum: 'SGT/099', typ: 'R', dt: dmy, val: 105, pos: '33', rev: 'N', itcavl: 'Y', txval: 100, igst: 0, cgst: 2.5, sgst: 2.5, cess: 0 },
              ],
            },
          ],
          cdnr: [],
        },
      },
    };
    // Not ours, and not a GSTR-2B: refused with plain messages.
    const other = { ...statement, data: { ...statement.data, gstin: gstin('27AAACR1234A1Z') } };
    expect((await owner.post('/gst/inward-statements').attach('file', Buffer.from(JSON.stringify(other)), 'gstr2b.json').expect(400)).body.message).toMatch(/not one of this company/);
    expect((await owner.post('/gst/inward-statements').attach('file', Buffer.from('not json'), 'gstr2b.json').expect(400)).body.message).toMatch(/not JSON/);
    expect((await owner.post('/gst/inward-statements').attach('file', Buffer.from('{"a":1}'), 'gstr2b.json').expect(400)).body.message).toMatch(/not a GSTR-2B/);

    const up = (await owner.post('/gst/inward-statements').attach('file', Buffer.from(JSON.stringify(statement)), 'GSTR2B.json').expect(201)).body;
    expect(up).toMatchObject({ gstin: MAIN_GSTIN, period: period(), documents: 3, fileName: 'GSTR2B.json' });
    expect((await owner.get('/gst/inward-statements').expect(200)).body).toHaveLength(1);

    const result = (await owner.get(`/gst/inward-statements/${up.id}/match`).expect(200)).body;
    expect(result.summary).toEqual({ matched: 1, value_difference: 1, only_portal: 1, only_books: 1 });
    const by = (n: string) => result.rows.find((r: { number: string }) => r.number === n);
    expect(by('sgt-1')).toMatchObject({ status: 'matched', books: { taxable: '2000.00' } });
    expect(by('SGT/002')).toMatchObject({ status: 'value_difference', differences: ['Taxable value: portal ₹3200.00, books ₹3000.00', 'CGST: portal ₹80.00, books ₹75.00', 'SGST: portal ₹80.00, books ₹75.00'] });
    expect(by('SGT/099')).toMatchObject({ status: 'only_portal', books: null });
    expect(by('SGT/003')).toMatchObject({ status: 'only_books', portal: null });
    // The unregistered tailor and the reverse-charge carrier have no GSTIN, so they are never in the statement.
    expect(result.rows).toHaveLength(4);
  });

  it('needs the input-credit right', async () => {
    const manager = await staff('Priya', 'priya@rademics.test', 'store_manager');
    await manager.get(`/gst/purchase-register?period=${period()}`).expect(403);
    await manager.get('/gst/inward-statements').expect(403);
    const accountant = await staff('Anand', 'anand@rademics.test', 'accountant');
    await accountant.get(`/gst/purchase-register?period=${period()}`).expect(200);
  });
});
