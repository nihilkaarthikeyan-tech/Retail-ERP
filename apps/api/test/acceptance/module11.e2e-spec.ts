// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 11" (plan 11).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { businessDate, type CurrentUser } from 'shared';
import { StockDocumentsService } from '../../src/inventory/stock-documents.service.js';
import { StockReportsService } from '../../src/inventory/stock-reports.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, OWNER, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: PrismaService;
let owner: Agent;
let MAIN: string;
let loc: Record<string, string>;
let pcs: string;
let groupId: string;
let listId: string;
let pm: Record<string, string>;
let tillId: string;
let tillToken: string;
let shiftClientId: string;
let ownerId: string;
let n = 0;

const today = () => businessDate();
const num = () => `MAIN-T1-2026-27-${String(++n).padStart(6, '0')}`;
const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

async function freshCompany(methods: string[] = ['CASH', 'CARD', 'UPI', 'ACCOUNT']) {
  owner = await setUpCompany(app, prisma);
  n = 0;
  MAIN = await storeId(prisma, 'MAIN');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findUniqueOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'MENS', name: 'Menswear' }).expect(201)).body.id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  await owner.post('/pos/gst-rates').send({ hsnCode: '6205', rate: '5', effectiveFrom: '2026-04-01' }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  const till = (
    await owner
      .post('/pos/tills')
      .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: methods.map((m, i) => ({ paymentMethodId: pm[m], isDefault: i === 0 })) })
      .expect(201)
  ).body;
  tillId = till.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
  ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } })).id;
  await owner.post('/pos/pin').send({ pin: '7391', currentPassword: OWNER.password }).expect(200);
}

async function item(name: string, price: string | null, extra: Record<string, unknown> = {}) {
  const i = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode: '6205', ...extra }).expect(201)).body as { id: string; code: string };
  if (price) await owner.post('/prices').send({ priceListId: listId, itemId: i.id, price, startDate: '2026-04-01' }).expect(201);
  return i;
}

async function opening(itemId: string, qty: string, cost: string) {
  const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId, countedQuantity: qty, unitCost: cost }] }).expect(201)).body;
  await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
}

async function openShift() {
  shiftClientId = randomUUID();
  await T(owner.post('/pos/shifts')).send({ clientId: shiftClientId, tillId, cash: [{ paymentMethodId: pm.CASH, amount: '2000' }] }).expect(201);
}

function sale(lines: Record<string, unknown>[], payments: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments, ...extra };
}

async function approval(action: string) {
  return (await owner.post('/pos/approvals').send({ tillId, managerId: ownerId, pin: '7391', action }).expect(200)).body.token as string;
}

async function cashier() {
  await owner.post('/users').send({ firstName: 'Ravi', email: 'ravi@rademics.test', temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, 'cashier')], storeIds: [MAIN] }).expect(201);
  const a = await login(app, 'ravi@rademics.test', 'Temp-pass-1234');
  await a.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
  return a;
}

async function expectConsistent() {
  expect(await app.get(StockReportsService).consistencyProblems()).toEqual([]);
}

describe('11.1 items that have moved cannot change their unit or tracking (A1)', () => {
  beforeAll(() => freshCompany());

  it('refuses unit, tracking and stock flag changes once stock has moved; other fields still change', async () => {
    const shirt = await item('Linen shirt', '1299');
    await opening(shirt.id, '10', '700');
    const box = (await prisma.unit.findFirstOrThrow({ where: { code: { not: 'PCS' } } })).id;
    for (const change of [{ trackBatches: true }, { trackSerials: true }, { isStockItem: false }, { baseUnitId: box }]) {
      expect((await owner.patch(`/items/${shirt.id}`).send(change).expect(400)).body.message).toMatch(/already has stock movements/);
    }
    await owner.patch(`/items/${shirt.id}`).send({ name: 'Linen shirt, white', mrp: '1399' }).expect(200);
    const fresh = await item('Cotton shirt', null);
    await owner.patch(`/items/${fresh.id}`).send({ trackBatches: true }).expect(200);
  });
});

describe('11.2 selling below cost and typed prices (A2)', () => {
  let shirt: { id: string; code: string };
  beforeAll(async () => {
    await freshCompany();
    shirt = await item('Formal shirt', '120');
    await opening(shirt.id, '20', '90');
    await prisma.item.update({ where: { id: shirt.id }, data: { lastPurchasePrice: '95' } });
    await prisma.till.update({ where: { id: tillId }, data: { allowPriceChange: true } });
    await openShift();
  });
  afterAll(expectConsistent);

  it('a typed price under the last purchase price needs a manager when "block selling below cost" is on', async () => {
    const settings = await prisma.catalogueSettings.findFirstOrThrow();
    await prisma.catalogueSettings.update({ where: { companyId: settings.companyId }, data: { allowPriceChangeOnBill: true, blockSellingBelowCost: true } });
    const res = await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1', price: '92' }], [{ paymentMethodId: pm.CASH, amount: '92' }])).expect(400);
    expect(res.body.message).toMatch(/below cost; a manager must approve/);
    const token = await approval('price_change');
    const ok = (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1', price: '92', approvalToken: token }], [{ paymentMethodId: pm.CASH, amount: '92' }])).expect(201)).body.sale;
    expect(ok.total).toBe('92.00');
    const history = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'pos_bill', entityId: ok.id } });
    expect(JSON.stringify(history.changes)).toMatch(/below cost/);
    // At the list price there is nothing to approve.
    await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '120' }])).expect(201);
  });

  it('a refused bill does not use up the approvals already given on it', async () => {
    const tie = await item('Silk tie', '300');
    await opening(tie.id, '10', '150');
    const first = await approval('price_change');
    const body = sale(
      [
        { itemId: tie.id, quantity: '1', price: '140', approvalToken: first },
        { itemId: shirt.id, quantity: '1', price: '91' },
      ],
      [{ paymentMethodId: pm.CASH, amount: '231' }],
    );
    expect((await T(owner.post('/pos/bills')).send(body).expect(400)).body.message).toMatch(/below cost/);
    // The manager approves the second line; the first line's approval still works.
    const second = await approval('price_change');
    (body.sale.lines as Record<string, unknown>[])[1] = { ...body.sale.lines[1], approvalToken: second };
    await T(owner.post('/pos/bills')).send({ ...body, clientId: randomUUID() }).expect(201);
    // Each approval is now used, once.
    await T(owner.post('/pos/bills')).send({ ...sale([{ itemId: tie.id, quantity: '1', price: '140', approvalToken: first }], [{ paymentMethodId: pm.CASH, amount: '140' }]) }).expect(403);
  });

  it('with "allow changing the price on a bill" off, even a till that allows it needs a manager', async () => {
    const settings = await prisma.catalogueSettings.findFirstOrThrow();
    await prisma.catalogueSettings.update({ where: { companyId: settings.companyId }, data: { allowPriceChangeOnBill: false, blockSellingBelowCost: false } });
    expect((await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1', price: '110' }], [{ paymentMethodId: pm.CASH, amount: '110' }])).expect(403)).body.message).toMatch(/manager must approve/);
    const token = await approval('price_change');
    await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1', price: '110', approvalToken: token }], [{ paymentMethodId: pm.CASH, amount: '110' }])).expect(201);
  });

  it('"save typed prices": an item with no price is sold at the typed price, which becomes its price', async () => {
    const settings = await prisma.catalogueSettings.findFirstOrThrow();
    await prisma.catalogueSettings.update({ where: { companyId: settings.companyId }, data: { allowPriceChangeOnBill: true, saveTypedPrices: true } });
    const belt = await item('Leather belt', null);
    await opening(belt.id, '5', '30');
    await T(owner.post('/pos/bills')).send(sale([{ itemId: belt.id, quantity: '1', price: '55' }], [{ paymentMethodId: pm.CASH, amount: '55' }])).expect(201);
    const price = await prisma.price.findFirstOrThrow({ where: { itemId: belt.id, priceListId: listId } });
    expect(price.price.toFixed(2)).toBe('55.00');
    expect(price.startDate.toISOString().slice(0, 10)).toBe(today());
    // Without the setting, a missing price is still refused.
    await prisma.catalogueSettings.update({ where: { companyId: settings.companyId }, data: { saveTypedPrices: false } });
    const cap = await item('Cotton cap', null);
    await opening(cap.id, '5', '30');
    expect((await T(owner.post('/pos/bills')).send(sale([{ itemId: cap.id, quantity: '1', price: '99' }], [{ paymentMethodId: pm.CASH, amount: '99' }])).expect(400)).body.message).toMatch(/has no price/);
  });
});

describe('11.3 supplier bill payment status (A3)', () => {
  it('unpaid → part paid → paid; a paid bill is never overdue and cannot be held; cancelling the payment brings it back', async () => {
    await freshCompany();
    const shirt = await item('Polo shirt', '799');
    const groups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
    const terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
    const supplier = (await owner.post('/suppliers').send({ name: 'Tiruppur Knits', supplierGroupId: groups.DISTRIBUTORS, paymentTermsId: terms.CASH }).expect(201)).body;
    const draft = (
      await owner
        .post('/purchase/bills')
        .send({ kind: 'receives_goods', supplierId: supplier.id, supplierBillNo: 'TK/101', supplierBillDate: today(), storeId: MAIN, lines: [{ itemId: shirt.id, quantity: '30', rate: '400', shelfLocationId: loc['MAIN-FLOOR'] }] })
        .expect(201)
    ).body;
    const bill = (await owner.post(`/purchase/bills/${draft.id}/finalise`).send({}).expect(200)).body;
    const total = Number(bill.total);
    const view = async () => (await owner.get(`/purchase/bills/${bill.id}`).expect(200)).body;
    expect(await view()).toMatchObject({ paymentStatus: 'unpaid', amountDue: total.toFixed(2) });

    const tree = (await owner.get('/accounts').expect(200)).body;
    const folder = tree.accounts.find((a: { systemKey: string }) => a.systemKey === 'bank_group');
    const bank = (await owner.post('/accounts').send({ parentId: folder.id, name: 'HDFC Current', kind: 'bank' }).expect(201)).body.id;
    const pay = async (amount: string) => {
      const p = (await owner.post('/payments').send({ kind: 'payment', paymentDate: today(), partyType: 'supplier', partyId: supplier.id, fromAccountId: bank, amount, reference: 'NEFT1', referenceDate: today() }).expect(201)).body;
      await owner.post(`/payments/${p.id}/post`).expect(200);
      return p.id as string;
    };
    await pay('5000');
    expect(await view()).toMatchObject({ paymentStatus: 'part_paid', amountDue: (total - 5000).toFixed(2) });
    const rest = await pay((total - 5000).toFixed(2));
    expect(await view()).toMatchObject({ paymentStatus: 'paid', amountDue: '0.00', overdue: false });
    const list = (await owner.get('/purchase/bills').expect(200)).body.rows;
    expect(list.find((b: { id: string }) => b.id === bill.id)).toMatchObject({ paymentStatus: 'paid' });
    const until = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    expect((await owner.post(`/purchase/bills/${bill.id}/hold`).send({ reason: 'Quality check', until }).expect(400)).body.message).toMatch(/already paid/);
    await owner.post(`/payments/${rest}/cancel`).send({ reason: 'Wrong amount' }).expect(200);
    expect(await view()).toMatchObject({ paymentStatus: 'part_paid' });
  });
});

describe('11.4 ledger screens show everything (A4)', () => {
  it('pages through every line; balances and totals always come from all lines', async () => {
    await freshCompany();
    await owner.get('/accounts').expect(200);
    const cash = (await prisma.account.findFirstOrThrow({ where: { systemKey: `cash_in_hand:${MAIN}` } })).id;
    const income = (await prisma.account.findFirstOrThrow({ where: { systemKey: 'other_income' } })).id;
    for (let i = 1; i <= 25; i++) {
      const j = (await owner.post('/journals').send({ journalDate: today(), lines: [{ accountId: cash, storeId: MAIN, debit: String(i) }, { accountId: income, storeId: MAIN, credit: String(i) }] }).expect(201)).body;
      await owner.post(`/journals/${j.id}/post`).expect(200);
    }
    const page = (p: number) => owner.get(`/reports/general-ledger?accountId=${cash}&from=${today()}&to=${today()}&pageSize=10&page=${p}`).expect(200);
    const first = (await page(1)).body;
    const third = (await page(3)).body;
    expect(first).toMatchObject({ total: 25, page: 1, pageSize: 10, opening: '0.00', totals: { debit: '325.00', credit: '0.00', closing: '325.00' } });
    expect(first.rows).toHaveLength(10);
    expect(third.rows).toHaveLength(5);
    expect(third.pageOpening).toBe('210.00');
    expect(third.rows.at(-1).balance).toBe('325.00');
    const book = (await owner.get(`/reports/day-book?from=${today()}&to=${today()}&pageSize=20&page=2`).expect(200)).body;
    expect(book).toMatchObject({ total: 25, page: 2 });
    expect(book.rows).toHaveLength(5);
  });
});

describe('11.5 a 20,000-line count (A5)', () => {
  it('finalises in one go; stock value is quantity × cost and every line has its stock entry', { timeout: 300_000 }, async () => {
    await freshCompany();
    const N = 20_000;
    await prisma.item.createMany({ data: Array.from({ length: N }, (_, i) => ({ code: `BIG-${String(i).padStart(5, '0')}`, name: `Bulk item ${i}`, itemGroupId: groupId, baseUnitId: pcs })) });
    const items = await prisma.item.findMany({ where: { code: { startsWith: 'BIG-' } }, select: { id: true } });
    await prisma.itemUnit.createMany({ data: items.map((i) => ({ itemId: i.id, unitId: pcs, factor: '1' })) });
    const user = (await owner.get('/auth/me').expect(200)).body as CurrentUser;
    const docs = app.get(StockDocumentsService);
    const draft = (await docs.createCount(
      { countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: items.map((i) => ({ itemId: i.id, countedQuantity: '3', unitCost: '12.5' })) },
      { userId: user.id, ipAddress: null },
      user,
    )) as { id: string };
    const t0 = Date.now();
    await owner.post(`/stock/documents/${draft.id}/finalise`).expect(200);
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(await prisma.stockLedgerEntry.count({ where: { documentId: draft.id } })).toBe(N);
    const value = await prisma.stockPosition.aggregate({ where: { locationId: loc['MAIN-FLOOR'] }, _sum: { value: true, quantity: true } });
    expect(value._sum.quantity?.toString()).toBe(String(3 * N));
    expect(value._sum.value?.toFixed(2)).toBe((3 * 12.5 * N).toFixed(2));
    const books = (await owner.get('/reports/stock-vs-accounts').expect(200)).body;
    expect(books.ok).toBe(true);
    await expectConsistent();
  });
});

describe('11.6 blocked customers and group credit limits (A6, A7)', () => {
  let shirt: { id: string };
  let groups: Record<string, string>;
  beforeAll(async () => {
    await freshCompany();
    shirt = await item('Kurta', '1000');
    await opening(shirt.id, '50', '600');
    groups = Object.fromEntries((await prisma.customerGroup.findMany()).map((g) => [g.code, g.id]));
    await openShift();
  });

  it('a blocked customer is refused online for a cashier, and kept with a flag offline', async () => {
    const c = (await owner.post('/customers').send({ name: 'Disputed Traders', customerGroupId: groups.RETAIL, mobile: '9840011111' }).expect(201)).body;
    await prisma.customer.update({ where: { id: c.id }, data: { status: 'blocked' } });
    const ravi = await cashier();
    const raviTill = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);
    expect((await raviTill(ravi.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '1000' }], { customerId: c.id })).expect(400)).body.message).toMatch(/blocked/);
    const offline = sale([{ itemId: shirt.id, quantity: '1', charged: { listPrice: '1000', price: '1000', discountAmount: '0', gstRate: '5', lineTotal: '1000' } }], [{ paymentMethodId: pm.CASH, amount: '1000' }], { customerId: c.id, offline: true, shiftClientId });
    const saved = (await raviTill(ravi.post('/pos/bills')).send(offline).expect(201)).body.sale;
    expect(saved.checkFlags).toContain('customer_blocked');
  });

  it('the group limit applies when the customer has none; a group can skip the check', async () => {
    // Created before the group had a limit, so the customer has no limit of its own.
    const c = (await owner.post('/customers').send({ name: 'Lakshmi Silks', customerGroupId: groups.RETAIL, mobile: '9840022222' }).expect(201)).body;
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).creditLimit.toFixed(2)).toBe('0.00');
    await prisma.customerGroup.update({ where: { id: groups.RETAIL }, data: { creditLimit: '10000' } });
    const onAccount = (qty: string, extra: Record<string, unknown> = {}) => sale([{ itemId: shirt.id, quantity: qty }], [{ paymentMethodId: pm.ACCOUNT, amount: String(Number(qty) * 1000) }], { customerId: c.id, ...extra });
    expect((await T(owner.post('/pos/bills')).send(onAccount('12')).expect(403)).body.message).toMatch(/Over the credit limit/);
    await T(owner.post('/pos/bills')).send(onAccount('8')).expect(201);
    await prisma.customerGroup.update({ where: { id: groups.RETAIL }, data: { creditLimit: '0', skipCreditCheck: true } });
    await T(owner.post('/pos/bills')).send(onAccount('15')).expect(201);
    // A group that skips the check wins even over a customer's own limit.
    await prisma.customer.update({ where: { id: c.id }, data: { creditLimit: '1000' } });
    await T(owner.post('/pos/bills')).send(onAccount('3')).expect(201);
  });
});

describe('11.7 bills need an order or a receipt (A8)', () => {
  it('a bill that receives goods by itself is refused when receipts are required, unless the supplier is excepted', async () => {
    await freshCompany();
    const shirt = await item('Denim shirt', '1499');
    const groups = Object.fromEntries((await prisma.supplierGroup.findMany()).map((g) => [g.code, g.id]));
    const terms = Object.fromEntries((await prisma.paymentTerms.findMany()).map((t) => [t.code, t.id]));
    const supplier = (await owner.post('/suppliers').send({ name: 'Erode Garments', supplierGroupId: groups.DISTRIBUTORS, paymentTermsId: terms.NET30 }).expect(201)).body;
    await owner.patch('/purchase/settings').send({ billNeedsReceipt: true }).expect(200);
    const bill = async (no: string) =>
      (await owner.post('/purchase/bills').send({ kind: 'receives_goods', supplierId: supplier.id, supplierBillNo: no, supplierBillDate: today(), storeId: MAIN, lines: [{ itemId: shirt.id, quantity: '10', rate: '700', shelfLocationId: loc['MAIN-FLOOR'] }] }).expect(201)).body.id as string;
    const first = await bill('EG/1');
    expect((await owner.post(`/purchase/bills/${first}/finalise`).send({}).expect(400)).body.message).toMatch(/goods receipt before/);
    await prisma.supplier.update({ where: { id: supplier.id }, data: { allowBillWithoutReceipt: true } });
    await owner.post(`/purchase/bills/${first}/finalise`).send({}).expect(200);

    await owner.patch('/purchase/settings').send({ billNeedsReceipt: false, billNeedsOrder: true }).expect(200);
    const second = await bill('EG/2');
    expect((await owner.post(`/purchase/bills/${second}/finalise`).send({}).expect(400)).body.message).toMatch(/must come from a purchase order/);
    await prisma.supplier.update({ where: { id: supplier.id }, data: { allowBillWithoutOrder: true } });
    await owner.post(`/purchase/bills/${second}/finalise`).send({}).expect(200);
  });
});
