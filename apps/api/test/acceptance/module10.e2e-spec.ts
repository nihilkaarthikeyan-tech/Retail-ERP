// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 10".
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { addDays, businessDate, ean13Modules } from 'shared';
import { readXlsx, type Sheet, writeXlsx } from '../../src/imports/spreadsheet.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: PrismaService;
let owner: Agent;
let MAIN: string;
let ANNA: string;
let loc: Record<string, string>;
let pcs: string;
let groupId: string;
let terms: Record<string, string>;
let supplierGroups: Record<string, string>;
let customerGroups: Record<string, string>;

const today = () => businessDate();

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

async function freshCompany() {
  owner = await setUpCompany(app, prisma);
  await owner.post('/stores').send({ code: 'ANNA', name: 'Anna Nagar' }).expect(201);
  MAIN = await storeId(prisma, 'MAIN');
  ANNA = await storeId(prisma, 'ANNA');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findUniqueOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'GROC', name: 'Grocery' }).expect(201)).body.id;
  terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
  supplierGroups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
  customerGroups = Object.fromEntries((await prisma.customerGroup.findMany()).map((g) => [g.code, g.id]));
}

async function staff(firstName: string, email: string, role: string, stores = [MAIN]) {
  await owner.post('/users').send({ firstName, email, temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, role)], storeIds: stores }).expect(201);
  const a = await login(app, email, 'Temp-pass-1234');
  await a.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
  return a;
}

/** Uploads a sheet for preview, runs it and waits for it to finish. */
async function importSheet(kind: string, rows: Sheet, mode = 'add', textColumns: number[] = []) {
  const file = writeXlsx('Import', rows, { textColumns });
  const preview = (await owner.post('/imports/preview').attach('file', file, `${kind}.xlsx`).field('options', JSON.stringify({ kind, mode })).expect(200)).body;
  await owner.post(`/imports/${preview.jobId}/run`).expect(200);
  for (let i = 0; i < 100; i++) {
    const s = (await owner.get(`/imports/${preview.jobId}`).expect(200)).body;
    if (s.status !== 'running') return { preview, status: s };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('The import did not finish');
}

const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('10.2 purchase order and 10.3 payment receipt prints, 10.11 store limits', () => {
  beforeAll(freshCompany);

  it('a purchase order prints with the store’s own GSTIN; a draft is marked DRAFT; every print is in the history', async () => {
    const s = (await owner.post('/suppliers').send({ name: 'Sri Murugan Traders', supplierGroupId: supplierGroups.DISTRIBUTORS, paymentTermsId: terms.NET30 }).expect(201)).body;
    const rice = (await owner.post('/items').send({ name: 'Ponni Rice 25 kg', itemGroupId: groupId, baseUnitId: pcs, hsnCode: '1006' }).expect(201)).body;
    const po = (await owner.post('/purchase/orders').send({ storeId: MAIN, supplierId: s.id, neededBy: addDays(today(), 7), lines: [{ itemId: rice.id, quantity: '10', rate: '1200', gstRate: '5' }] }).expect(201)).body;
    const draft = (await owner.get(`/print/purchase_order/${po.id}`).expect(200)).body;
    expect(draft).toMatchObject({ title: 'Purchase order', mark: 'DRAFT', paper: 'A4' });
    expect(draft.letterhead).toMatchObject({ legalName: 'Rademics Retail Pvt Ltd', gstin: '33AAACR1234A1ZV' });
    expect(draft.party).toMatchObject({ label: 'Supplier', name: 'Sri Murugan Traders' });
    expect(draft.lines[0]).toMatchObject({ item: expect.stringContaining('Ponni Rice'), rate: '1200.00', total: '12600.00' });
    expect(draft.totals).toContainEqual(['Total', '12600.00']);
    expect(draft.amountInWords).toBe('Rupees Twelve Thousand Six Hundred Only');
    await owner.post(`/purchase/orders/${po.id}/finalise`).expect(200);
    expect((await owner.get(`/print/purchase_order/${po.id}`).expect(200)).body.mark).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'print', entityType: 'purchase_order', entityId: po.id } })).toBe(2);

    // 10.11: a store manager of ANNA cannot print MAIN's order.
    const m = await staff('Priya', 'priya@rademics.test', 'store_manager', [ANNA]);
    await m.get(`/print/purchase_order/${po.id}`).expect(403);
  });

  it('a payment receipt prints with the bills it settled and the amount in words', async () => {
    const c = (await owner.post('/customers').send({ name: 'Lakshmi Stores', customerGroupId: customerGroups.RETAIL, mobile: '9840011223' }).expect(201)).body;
    await owner.post('/opening-bills').send({ partyType: 'customer', partyId: c.id, billNumber: 'OLD/101', billDate: '2026-08-01', amount: '1200.25' }).expect(201);
    const tree = (await owner.get('/accounts').expect(200)).body.accounts as { id: string; systemKey: string | null }[];
    const cash = tree.find((a) => a.systemKey === `cash_in_hand:${MAIN}`)!.id;
    const r = (await owner.post('/payments').send({ kind: 'receipt', paymentDate: today(), partyType: 'customer', partyId: c.id, toAccountId: cash, storeId: MAIN, amount: '1200.25' }).expect(201)).body;
    await owner.post(`/payments/${r.id}/post`).expect(200);
    const doc = (await owner.get(`/print/payment/${r.id}`).expect(200)).body;
    expect(doc).toMatchObject({ title: 'Payment receipt', mark: null, party: expect.objectContaining({ name: 'Lakshmi Stores' }) });
    expect(doc.lines).toEqual([expect.objectContaining({ bill: 'OLD/101', amount: '1200.25' })]);
    expect(doc.amountInWords).toBe('Rupees One Thousand Two Hundred and Twenty-Five Paise Only');
    const statement = (await owner.get(`/print/statement/customer:${c.id}`).expect(200)).body;
    expect(statement).toMatchObject({ title: 'Statement of account' });
  });
});

describe('10.4 labels', () => {
  beforeAll(freshCompany);

  it('copies, a goods receipt with batches, and items whose price changed', async () => {
    const list = (await owner.get('/price-lists').expect(200)).body.find((l: { code: string }) => l.code === 'STD-SELL');
    const atta = (await owner.post('/items').send({ name: 'Aashirvaad Atta 5 kg', itemGroupId: groupId, baseUnitId: pcs, hsnCode: '1101', mrp: '320' }).expect(201)).body;
    // A price from the start of the year, so it has not changed recently.
    await owner.post('/prices').send({ priceListId: list.id, itemId: atta.id, price: '299', startDate: '2026-04-01' }).expect(201);
    await owner.post(`/items/${atta.id}/barcodes`).send({ code: '8901234567890' }).expect(201);
    const copies = (await owner.post('/labels/data').send({ items: [{ itemId: atta.id, copies: 3 }] }).expect(200)).body;
    expect(copies.labels).toHaveLength(3);
    expect(copies.labels[0]).toMatchObject({ name: 'Aashirvaad Atta 5 kg', price: '299.00', mrp: '320.00' });
    expect(copies.labels[0].barcode).toEqual({ symbology: 'EAN13', modules: ean13Modules('8901234567890'), text: '8901234567890' });
    expect(copies.template.isDefault).toBe(true);

    const ghee = (await owner.post('/items').send({ name: 'Ghee 1 L', itemGroupId: groupId, baseUnitId: pcs, hsnCode: '0405', trackBatches: true }).expect(201)).body;
    const s = (await owner.post('/suppliers').send({ name: 'Aavin', supplierGroupId: supplierGroups.DISTRIBUTORS }).expect(201)).body;
    const d = (await owner.post('/purchase/receipts').send({ storeId: MAIN, supplierId: s.id, noOrderReason: 'Local', lines: [{ itemId: ghee.id, receivedQuantity: '12', rate: '550', gstRate: '12', batchNumber: 'G-77', expiryDate: addDays(today(), 90) }] }).expect(201)).body;
    await owner.post(`/purchase/receipts/${d.id}/finalise`).expect(200);
    const receipt = (await owner.post('/labels/data').send({ receiptId: d.id }).expect(200)).body;
    expect(receipt.labels).toHaveLength(12);
    expect(receipt.labels[0]).toMatchObject({ name: 'Ghee 1 L', batch: 'G-77', expiry: addDays(today(), 90) });
    expect(receipt.labels[0].barcode.symbology).toBe('CODE128');

    await owner.post('/prices').send({ priceListId: list.id, itemId: ghee.id, price: '620', startDate: today() }).expect(201);
    const changed = (await owner.post('/labels/data').send({ priceChangedSince: today() }).expect(200)).body;
    expect(changed.labels.map((l: { itemId: string }) => l.itemId)).toEqual([ghee.id]);
  });
});

describe('10.5–10.9 import and export', () => {
  beforeAll(freshCompany);

  it('10.5 adds three items, refuses the bad row with its number, adds it from the fixed failed-rows file, and adds nothing twice', async () => {
    const head = ['Item code', 'Item name', 'Item group code', 'Unit', 'HSN code', 'MRP', 'Selling price', 'Barcode', 'Second barcode', 'Pack unit', 'Pack size', 'Pack barcode'];
    const rows: Sheet = [
      head,
      ['', 'Toor Dal 1 kg', 'GROC', 'PCS', '0713', 180, 165, '8901030865278', '', '', null, ''],
      ['', 'Parle-G 100 g', 'GROC', 'PCS', '1905', 10, 10, '8901719110016', '8901719110023', 'BOX', 24, '8901719110030'],
      ['', 'Ghee 500 ml', 'XYZ', 'PCS', '0405', 300, 290, '', '', '', null, ''],
      ['', 'Salt 1 kg', 'GROC', 'PCS', '2501', 28, 25, '', '', '', null, ''],
    ];
    const first = await importSheet('items', rows, 'add', [0, 2, 3, 4, 7, 8, 9, 11]);
    expect(first.preview).toMatchObject({ rows: 4, ready: 4, unmatched: [] });
    expect(first.status).toMatchObject({ status: 'partly_done', added: 3, failed: 1 });
    expect(first.status.failedRows).toEqual([{ rowNumber: 4, message: 'Item group "XYZ" was not found' }]);
    const parle = await prisma.item.findFirstOrThrow({ where: { name: 'Parle-G 100 g' }, include: { barcodes: true, units: { include: { unit: true } } } });
    expect(parle.barcodes.map((b) => b.code).sort()).toEqual(['8901719110016', '8901719110023', '8901719110030']);
    expect(parle.units.map((u) => `${u.unit.code}:${u.factor.toString()}`).sort()).toEqual(['BOX:24', 'PCS:1']);

    const failed = (await owner.get(`/imports/${first.preview.jobId}/failed-rows`).buffer(true).parse(binary as never).expect(200)).body as Buffer;
    const fix = readXlsx(failed);
    expect(fix[0].at(-1)).toBe('Problem');
    expect(fix[1][2]).toBe('XYZ');
    fix[1][2] = 'GROC';
    const second = await importSheet('items', fix.map((r) => r.slice(0, -1)), 'add', [0, 2, 3, 4, 7, 8, 9, 11]);
    expect(second.status).toMatchObject({ status: 'done', added: 1, failed: 0 });

    const again = await importSheet('items', [...rows.slice(0, 3), rows[4]], 'add', [0, 2, 3, 4, 7, 8, 9, 11]);
    expect(again.status).toMatchObject({ added: 0, unchanged: 3, failed: 0 });
    expect(await prisma.item.count({ where: { name: { in: ['Toor Dal 1 kg', 'Parle-G 100 g', 'Ghee 500 ml', 'Salt 1 kg'] } } })).toBe(4);
  });

  it('10.6 keeps leading zeros and reads Indian numbers', async () => {
    const r = await importSheet(
      'items',
      [
        ['Item name', 'Item group code', 'Unit', 'HSN code', 'MRP', 'Barcode'],
        ['Darjeeling Tea 1 kg', 'GROC', 'PCS', '0902', '1,05,000.50', '0012345678905'],
      ],
      'add',
      [1, 2, 3, 4, 5],
    );
    expect(r.status).toMatchObject({ added: 1, failed: 0 });
    const tea = await prisma.item.findFirstOrThrow({ where: { name: 'Darjeeling Tea 1 kg' }, include: { barcodes: true } });
    expect(tea.hsnCode).toBe('0902');
    expect(tea.mrp?.toFixed(2)).toBe('105000.50');
    expect(tea.barcodes[0].code).toBe('0012345678905');
  });

  it('10.7 a new price start date adds a row and keeps the old; changing a customer’s mobile keeps the rest', async () => {
    const dal = await prisma.item.findFirstOrThrow({ where: { name: 'Toor Dal 1 kg' } });
    const r = await importSheet('prices', [['Price list code', 'Item code', 'Price', 'Start date'], ['STD-SELL', dal.code, '172', addDays(today(), 1)]], 'add', [0, 1]);
    expect(r.status).toMatchObject({ added: 1 });
    const prices = await prisma.price.findMany({ where: { itemId: dal.id }, orderBy: { startDate: 'asc' } });
    expect(prices.map((p) => p.price.toFixed(2))).toEqual(['165.00', '172.00']);

    const c = (await owner.post('/customers').send({ name: 'Hotel Saravana', customerGroupId: customerGroups.RETAIL, mobile: '9840055667', email: 'hs@example.in' }).expect(201)).body;
    const ch = await importSheet('customers', [['Customer code', 'Mobile'], [c.code, '9840099999']], 'change', [0, 1]);
    expect(ch.status).toMatchObject({ changed: 1, failed: 0 });
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(after).toMatchObject({ name: 'Hotel Saravana', mobile: '9840099999', email: 'hs@example.in' });
  });

  it('10.8 opening stock becomes draft opening counts per location; opening bills post against the temporary opening account', async () => {
    const dal = await prisma.item.findFirstOrThrow({ where: { name: 'Toor Dal 1 kg' } });
    const salt = await prisma.item.findFirstOrThrow({ where: { name: 'Salt 1 kg' } });
    const r = await importSheet(
      'opening_stock',
      [
        ['Store code', 'Location code', 'Item code', 'Quantity', 'Cost per unit'],
        ['MAIN', 'MAIN-FLOOR', dal.code, 40, 150],
        ['MAIN', 'MAIN-BACK', dal.code, 60, 150],
        ['MAIN', 'MAIN-FLOOR', salt.code, 100, 20],
      ],
      'add',
      [0, 1, 2],
    );
    expect(r.status).toMatchObject({ added: 3, failed: 0 });
    const counts = await prisma.stockDocument.findMany({ where: { kind: 'count', countType: 'opening', status: 'draft' }, include: { lines: true } });
    expect(counts.map((c) => c.lines.length).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(await prisma.stockLedgerEntry.count()).toBe(0);
    await owner.post(`/stock/documents/${counts[0].id}/finalise`).expect(200);
    expect(await prisma.stockLedgerEntry.count()).toBeGreaterThan(0);

    const c = await prisma.customer.findFirstOrThrow({ where: { name: 'Hotel Saravana' } });
    const bills = await importSheet('opening_bills', [['Customer or supplier', 'Party code', 'Bill number', 'Bill date', 'Due date', 'Amount still owed'], ['customer', c.code, 'OLD/9', '01/09/2026', '30/09/2026', '1,200']], 'add', [1, 2]);
    expect(bills.status).toMatchObject({ added: 1, failed: 0 });
    const items = (await owner.get(`/parties/customer/${c.id}/open-items`).expect(200)).body;
    expect(items).toEqual([expect.objectContaining({ number: 'OLD/9', owed: '1200.00', dueDate: '2026-09-30' })]);
    expect((await owner.get('/accounting/opening-check').expect(200)).body.ok).toBe(false);
  });

  it('10.9 an exported item list imported back in change mode has nothing to change', async () => {
    const file = (await owner.get('/exports/items').buffer(true).parse(binary as never).expect(200)).body as Buffer;
    const rows = readXlsx(file);
    expect(rows[0]).toContain('Item code');
    expect(rows.length).toBeGreaterThan(5);
    const textColumns = rows[0].flatMap((h, i) => (['Item code', 'Item group code', 'Brand code', 'Unit', 'HSN code', 'Barcode', 'Second barcode', 'Pack unit', 'Pack barcode'].includes(String(h)) ? [i] : []));
    const r = await importSheet('items', rows, 'change', textColumns);
    expect(r.status).toMatchObject({ status: 'done', added: 0, changed: 0, failed: 0, unchanged: rows.length - 1 });
    expect(await prisma.auditLog.count({ where: { action: 'export', entityType: 'list' } })).toBe(1);
  });

  it('10.11 a cashier can neither import nor export', async () => {
    const cashier = await staff('Arun', 'arun@rademics.test', 'cashier');
    await cashier.get('/imports/kinds').expect(403);
    await cashier.get('/exports/items').expect(403);
    await cashier.get('/imports/templates/items').expect(403);
  });
});

describe('10.10 clearing trial data (decision 72)', () => {
  beforeAll(freshCompany);

  it('keeps the master lists, removes every transaction, and is refused for good after go-live', async () => {
    // A trial: a receipt, a till sale and a payment.
    const list = (await owner.get('/price-lists').expect(200)).body.find((l: { code: string }) => l.code === 'STD-SELL');
    const rice = (await owner.post('/items').send({ name: 'Ponni Rice 1 kg', itemGroupId: groupId, baseUnitId: pcs, hsnCode: '1006', sellingPrice: '70' }).expect(201)).body;
    await owner.post('/pos/gst-rates').send({ hsnCode: '1006', rate: '5', effectiveFrom: '2026-04-01' }).expect(201);
    const s = (await owner.post('/suppliers').send({ name: 'Sri Murugan Traders', supplierGroupId: supplierGroups.DISTRIBUTORS }).expect(201)).body;
    const d = (await owner.post('/purchase/receipts').send({ storeId: MAIN, supplierId: s.id, noOrderReason: 'Trial', lines: [{ itemId: rice.id, receivedQuantity: '50', rate: '50', gstRate: '5' }] }).expect(201)).body;
    await owner.post(`/purchase/receipts/${d.id}/finalise`).expect(200);
    const pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
    const till = (await owner.post('/pos/tills').send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: list.id, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }] }).expect(201)).body;
    const token = (await owner.post(`/pos/tills/${till.id}/register`).send({ deviceName: 'PC' }).expect(201)).body.token;
    await owner.post('/pos/shifts').set('x-till-token', token).send({ clientId: randomUUID(), tillId: till.id, cash: [{ paymentMethodId: pm.CASH, amount: '0' }] }).expect(201);
    await owner
      .post('/pos/bills')
      .set('x-till-token', token)
      .send({ clientId: randomUUID(), tillId: till.id, soldAt: new Date().toISOString(), sale: { number: 'MAIN-T1-2026-27-000001', lines: [{ lineNo: 1, itemId: rice.id, quantity: '2' }] }, payments: [{ paymentMethodId: pm.CASH, amount: '140' }] })
      .expect(201);
    const before = { items: await prisma.item.count(), customers: await prisma.customer.count(), suppliers: await prisma.supplier.count(), prices: await prisma.price.count(), users: await prisma.user.count(), accounts: await prisma.account.count() };
    expect(await prisma.posBill.count()).toBe(1);
    expect(await prisma.ledgerLine.count()).toBeGreaterThan(0);

    const status = (await owner.get('/go-live').expect(200)).body;
    expect(status).toMatchObject({ goLiveDate: null, clearingAllowed: true, transactions: { bills: 1 } });
    await owner.post('/go-live/clear-trial-data').send({ confirmCompanyName: 'Rademics', reason: 'End of the trial' }).expect(400);
    const cleared = (await owner.post('/go-live/clear-trial-data').send({ confirmCompanyName: 'rademics retail pvt ltd', reason: 'End of the trial' }).expect(200)).body;
    expect(cleared.steps.length).toBeGreaterThan(3);

    expect({ items: await prisma.item.count(), customers: await prisma.customer.count(), suppliers: await prisma.supplier.count(), prices: await prisma.price.count(), users: await prisma.user.count(), accounts: await prisma.account.count() }).toEqual(before);
    for (const n of [await prisma.posBill.count(), await prisma.shift.count(), await prisma.stockLedgerEntry.count(), await prisma.stockPosition.count(), await prisma.ledgerLine.count(), await prisma.goodsReceipt.count(), await prisma.numberSeriesCounter.count()]) expect(n).toBe(0);
    expect(await prisma.tillDevice.count()).toBe(1);
    // The books are still in order after clearing.
    expect((await owner.get('/reports/book-health').expect(200)).body.ok).toBe(true);

    const m = await staff('Meena', 'meena@rademics.test', 'accountant');
    await m.post('/go-live/clear-trial-data').send({ confirmCompanyName: 'Rademics Retail Pvt Ltd', reason: 'x' }).expect(403);
    await owner.post('/go-live/date').send({ goLiveDate: today(), confirmCompanyName: 'Rademics Retail Pvt Ltd' }).expect(200);
    expect((await owner.post('/go-live/clear-trial-data').send({ confirmCompanyName: 'Rademics Retail Pvt Ltd', reason: 'Again' }).expect(403)).body.message).toMatch(/went live/);
    await owner.post('/go-live/date').send({ goLiveDate: addDays(today(), 1), confirmCompanyName: 'Rademics Retail Pvt Ltd' }).expect(400);
  });
});
