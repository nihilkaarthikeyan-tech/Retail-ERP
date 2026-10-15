// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 5".
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { addDays, businessDate } from 'shared';
import { StockReportsService } from '../../src/inventory/stock-reports.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: PrismaService;
let owner: Agent;
let loc: Record<string, string>;
let MAIN: string;
let pcs: string;
let groupId: string;
let terms: Record<string, string>;
let supplierGroups: Record<string, string>;

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
  MAIN = await storeId(prisma, 'MAIN');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findUniqueOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'GROC', name: 'Grocery' }).expect(201)).body.id;
  terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
  supplierGroups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
}

async function item(name: string, extra: Record<string, unknown> = {}) {
  return (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, ...extra }).expect(201)).body as { id: string; code: string };
}

async function supplier(name: string, extra: Record<string, unknown> = {}) {
  return (await owner.post('/suppliers').send({ name, supplierGroupId: supplierGroups.DISTRIBUTORS, paymentTermsId: terms.NET30, ...extra }).expect(201)).body as { id: string; code: string };
}

async function opening(itemId: string, qty: string, cost: string) {
  const count = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId, countedQuantity: qty, unitCost: cost }] }).expect(201)).body;
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

async function finalisedOrder(by: Agent, body: Record<string, unknown>) {
  const draft = (await by.post('/purchase/orders').send({ storeId: MAIN, neededBy: addDays(today(), 7), ...body }).expect(201)).body;
  return (await by.post(`/purchase/orders/${draft.id}/finalise`).expect(200)).body;
}

async function receive(by: Agent, body: Record<string, unknown>, expectStatus = 200) {
  const draft = (await by.post('/purchase/receipts').send({ storeId: MAIN, ...body }).expect(201)).body;
  const res = await by.post(`/purchase/receipts/${draft.id}/finalise`).expect(expectStatus);
  return { draft, res: res.body };
}

async function expectConsistent() {
  expect(await app.get(StockReportsService).consistencyProblems()).toEqual([]);
}

describe('5.1–5.5, 5.7 and 5.11: one order through its life', () => {
  let rice: { id: string; code: string };
  let smt: { id: string; code: string };
  let order: { id: string; lines: { id: string }[] };
  let receipt: { id: string; lines: { id: string }[] };
  let bill: { id: string };
  let ret: { id: string; number?: string };
  let overReceipt: { id: string };

  beforeAll(async () => {
    await freshCompany();
    rice = await item('Basmati Rice 1 kg');
    smt = await supplier('Sri Murugan Traders', { gstin: '33AAACM1234B1ZQ' });
    await opening(rice.id, '100', '90');
  });
  afterAll(expectConsistent);

  it('5.1 an order for 200 × ₹95 at 5% GST', async () => {
    order = await finalisedOrder(owner, { supplierId: smt.id, lines: [{ itemId: rice.id, quantity: '200', rate: '95', gstRate: '5' }] });
    expect(order).toMatchObject({ status: 'to_receive_and_bill', taxableAmount: '19000.00', taxAmount: '950.00', total: '19950.00', approvedAboveLimit: false });
    expect((order as unknown as { lines: Record<string, string>[] }).lines[0]).toMatchObject({ cgst: '475.00', sgst: '475.00', igst: '0.00', pendingQuantity: '200' });
    expect(order.id).toBeTruthy();
    // No stock moves for an order.
    expect(await position(rice.id, 'MAIN-FLOOR')).toEqual({ q: '100', cost: '90.0000', value: '9000.00' });
  });

  it('5.2 receiving 120: 118 accepted at the moving average, 2 rejected kept at cost', async () => {
    const { res } = await receive(owner, { supplierId: smt.id, deliveryNoteNo: 'DN-554', lines: [{ orderLineId: order.lines[0].id, itemId: rice.id, receivedQuantity: '120', rejectedQuantity: '2' }] });
    receipt = res;
    expect(res).toMatchObject({ status: 'to_bill', taxableAmount: '11400.00', taxAmount: '570.00', total: '11970.00', stockValue: '11400.00' });
    expect(res.number).toMatch(/^GRN-MAIN-2026-27-\d{5}$/);
    expect(await position(rice.id, 'MAIN-FLOOR')).toEqual({ q: '218', cost: '92.7064', value: '20210.00' });
    expect(await position(rice.id, 'MAIN-REJECT')).toEqual({ q: '2', cost: '95.0000', value: '190.00' });
    const ledger = (await owner.get(`/stock/ledger?itemId=${rice.id}`).expect(200)).body;
    expect(ledger.filter((e: { document: { kind: string } }) => e.document?.kind === 'goods_receipt').map((e: { accountRole: string }) => e.accountRole)).toEqual(['goods_received_not_billed', 'goods_received_not_billed']);
    const o = (await owner.get(`/purchase/orders/${order.id}`).expect(200)).body;
    expect(o).toMatchObject({ status: 'to_receive_and_bill', receivedPercent: '60.00' });
    expect(o.lines[0].pendingQuantity).toBe('80');
    expect((await prisma.item.findUniqueOrThrow({ where: { id: rice.id } })).lastPurchasePrice?.toFixed(4)).toBe('95.0000');
  });

  it('5.3 the supplier bill against the receipt, due 30 days from its date', async () => {
    const draft = (
      await owner
        .post('/purchase/bills')
        .send({ kind: 'against_receipt', supplierId: smt.id, supplierBillNo: 'SMT/1182', supplierBillDate: today(), lines: [{ receiptLineId: receipt.lines[0].id, itemId: rice.id, quantity: '120' }] })
        .expect(201)
    ).body;
    expect(draft).toMatchObject({ taxableAmount: '11400.00', taxAmount: '570.00', total: '11970.00', dueDate: addDays(today(), 30), priceDifference: '0.00' });
    expect(draft.lines[0]).toMatchObject({ cgst: '285.00', sgst: '285.00', accountRole: 'goods_received_not_billed' });
    bill = (await owner.post(`/purchase/bills/${draft.id}/finalise`).send({}).expect(200)).body;
    expect(bill).toMatchObject({ status: 'unpaid' });
    expect((await owner.get(`/purchase/receipts/${receipt.id}`).expect(200)).body).toMatchObject({ status: 'completed', billedPercent: '100.00' });
    expect((await owner.get(`/purchase/orders/${order.id}`).expect(200)).body).toMatchObject({ billedPercent: '60.00' });
  });

  it('5.4 the same bill number from the same supplier in the same year is refused', async () => {
    const res = await owner
      .post('/purchase/bills')
      .send({ kind: 'against_receipt', supplierId: smt.id, supplierBillNo: 'smt/1182', supplierBillDate: today(), lines: [{ receiptLineId: receipt.lines[0].id, itemId: rice.id, quantity: '1' }] })
      .expect(400);
    expect(res.body.message).toMatch(/SMT\/1182 from this supplier is already recorded/);
  });

  it('5.5 returning the 2 rejected bags at their original cost', async () => {
    ret = (await owner.post(`/purchase/receipts/${receipt.id}/return`).send({ reason: 'Torn bags', lines: [{ originalLineId: receipt.lines[0].id, rejectedQuantity: '2' }] }).expect(201)).body;
    expect(ret).toMatchObject({ isReturn: true, status: 'completed', stockValue: '-190.00' });
    expect(ret.number ?? '').toMatch(/^PRT-MAIN-2026-27-\d{5}$/);
    expect(await position(rice.id, 'MAIN-REJECT')).toEqual({ q: '0', cost: '95.0000', value: '0.00' });
    expect(await position(rice.id, 'MAIN-FLOOR')).toEqual({ q: '218', cost: '92.7064', value: '20210.00' });
    const o = (await owner.get(`/purchase/orders/${order.id}`).expect(200)).body;
    expect(o.lines[0].pendingQuantity).toBe('82');
    // Not more than was rejected.
    await owner.post(`/purchase/receipts/${receipt.id}/return`).send({ reason: 'Again', lines: [{ originalLineId: receipt.lines[0].id, rejectedQuantity: '1' }] }).expect(400);
  });

  it('5.7 receiving 83 when 82 are expected: refused for staff, a warning for the over-receive right', async () => {
    const receiver = await staff('Ravi', 'ravi@rademics.test', 'stock_receiving');
    const body = { supplierId: smt.id, lines: [{ orderLineId: order.lines[0].id, itemId: rice.id, receivedQuantity: '83' }] };
    const { res: refused } = await receive(receiver, body, 400);
    expect(refused.message).toMatch(/83 received but only 82 still expected/);
    const { res } = await receive(owner, body);
    overReceipt = res;
    expect(res.warnings).toHaveLength(1);
    expect((await owner.get(`/purchase/orders/${order.id}`).expect(200)).body).toMatchObject({ receivedPercent: '100.00', status: 'to_bill' });
    // Receiving staff never see buying prices (decision 70).
    const seen = (await receiver.get(`/purchase/receipts/${res.id}`).expect(200)).body;
    expect(seen.lines[0].rate).toBeUndefined();
    expect(seen.total).toBeUndefined();
  });

  it('5.11 cancelling: refused while a bill or return refers to the receipt; afterwards stock is back exactly', async () => {
    const blocked = await owner.post(`/purchase/receipts/${receipt.id}/cancel`).send({ reason: 'Wrong supplier' }).expect(400);
    expect(blocked.body.message).toMatch(/supplier bill refers to this receipt/);
    const c1 = await owner.post(`/purchase/bills/${bill.id}/cancel`).send({ reason: 'Re-enter' });
    expect(c1.status).toBe(200);
    await owner.post(`/purchase/receipts/${receipt.id}/cancel`).send({ reason: 'Wrong supplier' }).expect(400); // the return still refers to it
    const c2 = await owner.post(`/purchase/receipts/${ret.id}/cancel`).send({ reason: 'Undo' });
    expect(c2.status).toBe(200);
    const c3 = await owner.post(`/purchase/receipts/${overReceipt.id}/cancel`).send({ reason: 'Undo' });
    expect(c3.status).toBe(200);
    const c4 = await owner.post(`/purchase/receipts/${receipt.id}/cancel`).send({ reason: 'Wrong supplier' });
    const cancelled = c4.body;
    expect(cancelled.status).toBe('cancelled');
    expect(await position(rice.id, 'MAIN-FLOOR')).toEqual({ q: '100', cost: '90.0000', value: '9000.00' });
    expect(await position(rice.id, 'MAIN-REJECT')).toEqual({ q: '0', cost: '95.0000', value: '0.00' });
    expect((await owner.get(`/purchase/orders/${order.id}`).expect(200)).body).toMatchObject({ receivedPercent: '0.00', billedPercent: '0.00', status: 'to_receive_and_bill' });
  });
});

describe('5.4 bill numbers in another year or from another supplier', () => {
  beforeAll(freshCompany);

  it('the same number is accepted from another supplier, and from the same supplier in another financial year', async () => {
    const smt = await supplier('Sri Murugan Traders', { gstin: '33AAACM1234B1ZQ' });
    const other = await supplier('Lakshmi Agencies', { stateCode: '33' });
    const service = await item('Unloading charges', { isStockItem: false });
    const body = (s: string, billDate: string) => ({ kind: 'services', supplierId: s, supplierBillNo: 'SMT/1182', supplierBillDate: billDate, lines: [{ itemId: service.id, quantity: '1', rate: '500', gstRate: '18' }] });
    const first = (await owner.post('/purchase/bills').send(body(smt.id, today())).expect(201)).body;
    expect(first).toMatchObject({ taxableAmount: '500.00', taxAmount: '90.00', total: '590.00' });
    expect(first.lines[0].accountRole).toBe('purchase_expense');
    await owner.post(`/purchase/bills/${first.id}/finalise`).send({}).expect(200);
    await owner.post('/purchase/bills').send(body(smt.id, today())).expect(400);
    await owner.post('/purchase/bills').send(body(other.id, today())).expect(201);
    await owner.post('/financial-years').send({ startDate: '2025-04-01', endDate: '2026-03-31' }).expect(201);
    await owner.post('/purchase/bills').send(body(smt.id, '2026-03-15')).expect(201);
  });
});

describe('5.6 receiving without an order (decision 31)', () => {
  beforeAll(freshCompany);

  it('staff are refused; a Store Manager needs a reason, which is kept in the history', async () => {
    const dal = await item('Moong Dal 1 kg');
    const smt = await supplier('Sri Murugan Traders', { gstin: '33AAACM1234B1ZQ' });
    await prisma.item.update({ where: { id: dal.id }, data: { lastPurchasePrice: '110' } });
    const receiver = await staff('Ravi', 'ravi@rademics.test', 'stock_receiving');
    const manager = await staff('Priya', 'priya@rademics.test', 'store_manager');
    const lines = [{ itemId: dal.id, receivedQuantity: '10' }];
    await receiver.post('/purchase/receipts').send({ storeId: MAIN, supplierId: smt.id, noOrderReason: 'Urgent', lines }).expect(403);
    await manager.post('/purchase/receipts').send({ storeId: MAIN, supplierId: smt.id, lines }).expect(400);
    const { res } = await receive(manager, { supplierId: smt.id, noOrderReason: 'Festival rush, order to follow', lines });
    expect(res.status).toBe('to_bill');
    expect(await position(dal.id, 'MAIN-FLOOR')).toEqual({ q: '10', cost: '110.0000', value: '1100.00' });
    const history = await prisma.auditLog.findMany({ where: { entityType: 'goods_receipt', entityId: res.id } });
    expect(JSON.stringify(history.map((h) => h.changes))).toContain('Festival rush, order to follow');
  });
});

describe('5.8 free goods, 5.9 extra charges and 5.10 a bill that receives the goods', () => {
  let smt: { id: string; code: string };
  beforeAll(async () => {
    await freshCompany();
    smt = await supplier('Sri Murugan Traders', { gstin: '33AAACM1234B1ZQ' });
  });
  afterAll(expectConsistent);

  it('5.8 10 paid at ₹100 with 2 free enter at ₹83.3333 (decision 27)', async () => {
    const toor = await item('Toor Dal 1 kg');
    const { res } = await receive(owner, { supplierId: smt.id, noOrderReason: 'Scheme offer', lines: [{ itemId: toor.id, receivedQuantity: '12', freeQuantity: '2', rate: '100', gstRate: '5' }] });
    expect(res).toMatchObject({ taxableAmount: '1000.00', taxAmount: '50.00' });
    expect(res.lines[0].unitCost).toBe('83.3333');
    expect(await position(toor.id, 'MAIN-FLOOR')).toEqual({ q: '12', cost: '83.3333', value: '1000.00' });
  });

  it('5.9 freight of ₹600 shared by value; a later write-off is re-costed', async () => {
    const sona = await item('Sona Masoori Rice 1 kg');
    const moong = await item('Moong Dal 500 g');
    const { res: r } = await receive(owner, {
      supplierId: smt.id,
      noOrderReason: 'Local purchase',
      lines: [
        { itemId: sona.id, receivedQuantity: '100', rate: '95', gstRate: '5' },
        { itemId: moong.id, receivedQuantity: '25', rate: '100', gstRate: '5' },
      ],
    });
    // A write-off after the goods arrived, before the freight bill came in.
    const wo = (await owner.post('/stock/documents').send({ kind: 'stock_out', reason: 'damage', storeId: MAIN, fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: sona.id, quantity: '10' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${wo.id}/finalise`).expect(200);

    const body = { shareBy: 'value', receiptIds: [r.id], charges: [{ description: 'Lorry freight', chargeType: 'freight', amount: '600' }] };
    const preview = (await owner.post('/purchase/charges/preview').send(body).expect(200)).body;
    expect(preview.shares.map((s: { share: string }) => s.share)).toEqual(['475.00', '125.00']);
    const draft = (await owner.post('/purchase/charges').send(body).expect(201)).body;
    const done = (await owner.post(`/purchase/charges/${draft.id}/finalise`).expect(200)).body;
    expect(done.status).toBe('finalised');
    expect(await position(sona.id, 'MAIN-FLOOR')).toEqual({ q: '90', cost: '99.7500', value: '8977.50' });
    expect(await position(moong.id, 'MAIN-FLOOR')).toEqual({ q: '25', cost: '105.0000', value: '2625.00' });
    const writeOff = await prisma.stockLedgerEntry.findFirstOrThrow({ where: { documentId: wo.id } });
    expect(writeOff.valueChange.toFixed(2)).toBe('-997.50');

    // The receipt cannot be cancelled while the charges stand; cancelling them restores the costs.
    await owner.post(`/purchase/receipts/${r.id}/cancel`).send({ reason: 'x' }).expect(400);
    await owner.post(`/purchase/charges/${draft.id}/cancel`).send({ reason: 'Wrong receipt' }).expect(200);
    expect(await position(sona.id, 'MAIN-FLOOR')).toEqual({ q: '90', cost: '95.0000', value: '8550.00' });
  });

  it('5.10 a cash-style bill that also receives the goods', async () => {
    const salt = await item('Tata Salt 1 kg');
    const draft = (
      await owner
        .post('/purchase/bills')
        .send({ kind: 'receives_goods', supplierId: smt.id, storeId: MAIN, supplierBillNo: 'SMT/1190', supplierBillDate: today(), lines: [{ itemId: salt.id, quantity: '5', rate: '40', gstRate: '5' }] })
        .expect(201)
    ).body;
    expect(draft).toMatchObject({ taxableAmount: '200.00', taxAmount: '10.00', total: '210.00' });
    expect(draft.lines[0].accountRole).toBe('stock');
    const bill = (await owner.post(`/purchase/bills/${draft.id}/finalise`).send({}).expect(200)).body;
    expect(bill.receiptId).toBeTruthy();
    expect(await position(salt.id, 'MAIN-FLOOR')).toEqual({ q: '5', cost: '40.0000', value: '200.00' });
    expect((await owner.get(`/purchase/receipts/${bill.receiptId}`).expect(200)).body).toMatchObject({ status: 'completed', billId: bill.id });
    // Its receipt is cancelled only through the bill.
    await owner.post(`/purchase/receipts/${bill.receiptId}/cancel`).send({ reason: 'x' }).expect(400);
    await owner.post(`/purchase/bills/${bill.id}/cancel`).send({ reason: 'Wrong supplier' }).expect(200);
    expect(await position(salt.id, 'MAIN-FLOOR')).toEqual({ q: '0', cost: '40.0000', value: '0.00' });
  });
});

describe('5.12 held supplier and expired batch', () => {
  beforeAll(freshCompany);

  it('a supplier held for bills gets no new order or bill; an expired batch cannot be received', async () => {
    const held = await supplier('Metro Distributors', { stateCode: '33' });
    const ghee = await item('Cow Ghee 500 ml', { trackBatches: true });
    await owner.patch(`/suppliers/${held.id}/hold`).send({ holdType: 'bills', holdReason: 'Disputed invoice' }).expect(200);
    const order = await owner.post('/purchase/orders').send({ supplierId: held.id, storeId: MAIN, neededBy: addDays(today(), 3), lines: [{ itemId: ghee.id, quantity: '10', rate: '300', gstRate: '12' }] }).expect(400);
    expect(order.body.message).toMatch(/on hold for bills/);
    await owner.patch(`/suppliers/${held.id}/hold`).send({ holdType: 'none' }).expect(200);

    const yesterday = addDays(today(), -1);
    const { res } = await receive(owner, { supplierId: held.id, noOrderReason: 'Sample', lines: [{ itemId: ghee.id, receivedQuantity: '5', rate: '300', gstRate: '12', batchNumber: 'GH-0925', expiryDate: yesterday }] }, 400);
    expect(res.message).toMatch(/expired on/);
  });
});

describe('5.13 reorder suggestions', () => {
  beforeAll(freshCompany);

  it('below the level a suggestion of the reorder quantity becomes a draft order; then nothing more is suggested', async () => {
    const smt = await supplier('Sri Murugan Traders', { gstin: '33AAACM1234B1ZQ' });
    const sugar = await item('Sugar 1 kg');
    await prisma.item.update({ where: { id: sugar.id }, data: { preferredSupplierId: smt.id, lastPurchasePrice: '42' } });
    await opening(sugar.id, '30', '40');
    await owner.post('/stock/reorder-levels').send({ itemId: sugar.id, storeId: MAIN, level: '50', quantity: '100' }).expect(201);

    await owner.post('/purchase/reorder-suggestions/run').expect(200);
    const [s] = (await owner.get('/purchase/reorder-suggestions').expect(200)).body;
    expect(s).toMatchObject({ onHand: '30', onOrder: '0', suggestedQuantity: '100', supplier: { id: smt.id } });

    const { orderIds } = (await owner.post('/purchase/reorder-suggestions/create-orders').send({ suggestionIds: [s.id] }).expect(201)).body;
    expect(orderIds).toHaveLength(1);
    const order = (await owner.get(`/purchase/orders/${orderIds[0]}`).expect(200)).body;
    expect(order).toMatchObject({ status: 'draft', supplier: { id: smt.id } });
    expect(order.lines[0]).toMatchObject({ quantity: '100', rate: '42' });
    // Changing the quantity without sending a price keeps the saved price (not re-priced from the list).
    await prisma.item.update({ where: { id: sugar.id }, data: { lastPurchasePrice: '50' } });
    const changed = (await owner.patch(`/purchase/orders/${order.id}`).send({ lines: [{ lineId: order.lines[0].id, itemId: sugar.id, quantity: '120' }] }).expect(200)).body;
    expect(changed.lines[0]).toMatchObject({ quantity: '120', rate: '42', taxableAmount: '5040.00' });

    await owner.post('/purchase/reorder-suggestions/run').expect(200);
    expect((await owner.get('/purchase/reorder-suggestions').expect(200)).body).toEqual([]);
  });
});

describe('approval limit, row locking and rights', () => {
  let smt: { id: string; code: string };
  let atta: { id: string; code: string };
  beforeAll(async () => {
    await freshCompany();
    smt = await supplier('Sri Murugan Traders', { gstin: '33AAACM1234B1ZQ' });
    atta = await item('Aashirvaad Atta 5 kg');
  });
  afterAll(expectConsistent);

  it('orders above ₹50,000 need a Store Manager or Owner to finalise (decision 69)', async () => {
    await owner
      .post('/roles')
      .send({ code: 'buyer', name: 'Buyer', permissions: ['purchase.view', 'purchase.order', 'suppliers.view', 'catalogue.view', 'stores.view', 'buying_prices.view'] })
      .expect(201);
    await owner.post('/users').send({ firstName: 'Anand', email: 'anand@rademics.test', temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, 'buyer')], storeIds: [MAIN] }).expect(201);
    const buyer = await login(app, 'anand@rademics.test', 'Temp-pass-1234');
    await buyer.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);

    const big = (await buyer.post('/purchase/orders').send({ supplierId: smt.id, storeId: MAIN, neededBy: addDays(today(), 7), lines: [{ itemId: atta.id, quantity: '200', rate: '285', gstRate: '5' }] }).expect(201)).body;
    expect(big.total).toBe('59850.00');
    const refused = await buyer.post(`/purchase/orders/${big.id}/finalise`).expect(403);
    expect(refused.body.message).toMatch(/above ₹50000.00 need a Store Manager or Owner/);
    const manager = await staff('Priya', 'priya@rademics.test', 'store_manager');
    expect((await manager.post(`/purchase/orders/${big.id}/finalise`).expect(200)).body).toMatchObject({ status: 'to_receive_and_bill', approvedAboveLimit: true });
  });

  it('two receivers finalising the last 10 of an order at once: exactly one succeeds (rule 7)', async () => {
    const order = await finalisedOrder(owner, { supplierId: smt.id, lines: [{ itemId: atta.id, quantity: '10', rate: '285', gstRate: '5' }] });
    const a = await staff('Ravi', 'ravi@rademics.test', 'stock_receiving');
    const b = await staff('Meena', 'meena@rademics.test', 'stock_receiving');
    const body = { storeId: MAIN, supplierId: smt.id, lines: [{ orderLineId: order.lines[0].id, itemId: atta.id, receivedQuantity: '10' }] };
    const da = (await a.post('/purchase/receipts').send(body).expect(201)).body;
    const db = (await b.post('/purchase/receipts').send(body).expect(201)).body;
    const results = await Promise.all([a.post(`/purchase/receipts/${da.id}/finalise`), b.post(`/purchase/receipts/${db.id}/finalise`)]);
    expect(results.map((r) => r.status).sort((x, y) => x - y)).toEqual([200, 400]);
    expect(await position(atta.id, 'MAIN-FLOOR')).toMatchObject({ q: '10' });
  });

  it('cashiers have no purchasing rights; hold, close and cancel follow the rules', async () => {
    const cashier = await staff('Kavya', 'kavya@rademics.test', 'cashier');
    await cashier.get('/purchase/orders').expect(403);
    const order = await finalisedOrder(owner, { supplierId: smt.id, lines: [{ itemId: atta.id, quantity: '5', rate: '285', gstRate: '5' }] });
    await owner.post(`/purchase/orders/${order.id}/hold`).send({ reason: 'Price check' }).expect(200);
    await owner.post('/purchase/receipts').send({ storeId: MAIN, supplierId: smt.id, lines: [{ orderLineId: order.lines[0].id, itemId: atta.id, receivedQuantity: '5' }] }).expect(400);
    await owner.post(`/purchase/orders/${order.id}/release`).expect(200);
    await owner.post(`/purchase/orders/${order.id}/close`).send({ reason: 'Supplier out of stock' }).expect(200);
    await owner.post(`/purchase/orders/${order.id}/reopen`).expect(200);
    expect((await owner.post(`/purchase/orders/${order.id}/cancel`).send({ reason: 'Not needed' }).expect(200)).body.status).toBe('cancelled');
  });
});
