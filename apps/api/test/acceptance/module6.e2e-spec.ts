// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 6".
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { addDays, businessDate } from 'shared';
import { StockReportsService } from '../../src/inventory/stock-reports.service.js';
import { SystemPrisma } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, OWNER, roleId, setUpCompany, storeId } from '../helpers.js';

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
let shiftClientId: string;
let n = 0;

const today = () => businessDate();
const num = (prefix = 'MAT1') => `${prefix}/2627/${String(++n).padStart(6, '0')}`;
const T = (r: ReturnType<Agent['post']>) => r.set('x-till-token', tillToken);

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

async function freshTill(extra: Record<string, unknown> = {}) {
  owner = await setUpCompany(app, prisma);
  n = 0;
  MAIN = await storeId(prisma, 'MAIN');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'GROC', name: 'Grocery' }).expect(201)).body.id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  for (const [hsnCode, rate] of [['1006', '5'], ['3402', '18'], ['1905', '18'], ['0902', '5'], ['1101', '5']]) await owner.post('/pos/gst-rates').send({ hsnCode, rate, effectiveFrom: '2026-04-01' }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  const till = (
    await owner
      .post('/pos/tills')
      .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }, { paymentMethodId: pm.CARD }, { paymentMethodId: pm.UPI }], ...extra })
      .expect(201)
  ).body;
  tillId = till.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
}

async function item(name: string, hsnCode: string, price: string, extra: Record<string, unknown> = {}) {
  const i = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode, ...extra }).expect(201)).body as { id: string; code: string };
  await owner.post('/prices').send({ priceListId: listId, itemId: i.id, price, startDate: '2026-04-01' }).expect(201);
  return i;
}

async function opening(itemId: string, qty: string, cost: string) {
  const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId, countedQuantity: qty, unitCost: cost }] }).expect(201)).body;
  await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
}

async function openShift(by: Agent, cash = '2000') {
  shiftClientId = randomUUID();
  return (await T(by.post('/pos/shifts')).send({ clientId: shiftClientId, tillId, cash: [{ paymentMethodId: pm.CASH, amount: cash }] }).expect(201)).body;
}

async function position(itemId: string) {
  const p = await prisma.stockPosition.findUnique({ where: { itemId_locationId: { itemId, locationId: loc['MAIN-FLOOR'] } } });
  return { q: p?.quantity.toString() ?? '0', cost: p?.unitCost.toFixed(4) ?? '0.0000' };
}

function sale(lines: Record<string, unknown>[], payments: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments, ...extra };
}

async function staff(firstName: string, email: string, role: string) {
  await owner.post('/users').send({ firstName, email, temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, role)], storeIds: [MAIN] }).expect(201);
  const a = await login(app, email, 'Temp-pass-1234');
  await a.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
  return { agent: a, id: (await prisma.user.findUniqueOrThrow({ where: { email } })).id };
}

async function expectConsistent() {
  expect(await app.get(StockReportsService).consistencyProblems()).toEqual([]);
}

describe('6.1–6.3 and 6.5: a day at the till', () => {
  let basmati: { id: string };
  let surf: { id: string };
  let ariel: { id: string };
  let first: { id: string; lines: { id: string; item: { id: string } }[] };

  beforeAll(async () => {
    await freshTill();
    basmati = await item('Basmati Rice 1 kg', '1006', '120');
    surf = await item('Surf Excel 1 kg', '3402', '132');
    ariel = await item('Ariel 1 kg', '3402', '150');
    await opening(basmati.id, '100', '90');
    await opening(surf.id, '50', '95');
    await opening(ariel.id, '20', '110');
    await openShift(owner);
  });
  afterAll(expectConsistent);

  it('6.1 a sale of ₹372.00 with ₹128.00 change; stock leaves at once', async () => {
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: basmati.id, quantity: '2' }, { itemId: surf.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '500' }])).expect(201)).body;
    first = res.sale;
    expect(res.sale).toMatchObject({ total: '372.00', taxableAmount: '340.43', cgst: '15.79', sgst: '15.78', changeAmount: '128.00', gstProvisional: false, costValue: '275.00' });
    expect(res.sale.lines.map((l: Record<string, string>) => [l.taxableAmount, l.cgst, l.sgst, l.costValue])).toEqual([
      ['228.57', '5.72', '5.71', '180.00'],
      ['111.86', '10.07', '10.07', '95.00'],
    ]);
    expect(res.change).toBe('128.00');
    expect(await position(basmati.id)).toEqual({ q: '98', cost: '90.0000' });
    expect(await position(surf.id)).toEqual({ q: '49', cost: '95.0000' });
    const ledger = (await owner.get(`/stock/ledger?itemId=${basmati.id}`).expect(200)).body;
    expect(ledger[0]).toMatchObject({ accountRole: 'cost_of_goods_sold', document: { kind: 'pos_sale' } });
  });

  it('6.2 a return of 1 Basmati: ₹120.00 back, stock at the original cost; no more than sold', async () => {
    const basLine = first.lines.find((l) => l.item.id === basmati.id)!;
    const body = { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), ret: { number: num(), returnOfId: first.id, lines: [{ lineNo: 1, itemId: basmati.id, quantity: '1', returnOfLineId: basLine.id }] }, payments: [{ paymentMethodId: pm.CASH, amount: '-120' }] };
    const res = (await T(owner.post('/pos/bills')).send(body).expect(201)).body;
    expect(res.return).toMatchObject({ total: '-120.00', taxableAmount: '-114.29', cgst: '-2.86', sgst: '-2.85' });
    expect(await position(basmati.id)).toEqual({ q: '99', cost: '90.0000' });
    const again = { ...body, clientId: randomUUID(), ret: { ...body.ret, number: num(), lines: [{ ...body.ret.lines[0], quantity: '2' }] }, payments: [{ paymentMethodId: pm.CASH, amount: '-240' }] };
    expect((await T(owner.post('/pos/bills')).send(again).expect(400)).body.message).toMatch(/only 1 left to return/);
  });

  it('6.3 an exchange on one screen: Surf back, Ariel out, ₹18.00 to pay', async () => {
    const surfLine = first.lines.find((l) => l.item.id === surf.id)!;
    const res = (
      await T(owner.post('/pos/bills'))
        .send({
          clientId: randomUUID(),
          tillId,
          soldAt: new Date().toISOString(),
          ret: { number: num(), returnOfId: first.id, lines: [{ lineNo: 1, itemId: surf.id, quantity: '1', returnOfLineId: surfLine.id }] },
          sale: { number: num(), lines: [{ lineNo: 1, itemId: ariel.id, quantity: '1' }] },
          payments: [{ paymentMethodId: pm.CASH, amount: '18' }],
        })
        .expect(201)
    ).body;
    expect(res.net).toBe('18.00');
    expect(res.return.exchangeId).toBe(res.sale.exchangeId);
    expect([res.return.total, res.sale.total]).toEqual(['-132.00', '150.00']);
    expect(await position(surf.id)).toEqual({ q: '50', cost: '95.0000' });
    expect(await position(ariel.id)).toEqual({ q: '19', cost: '110.0000' });
  });

  it('6.5 closing: expected ₹2,070.00, counted ₹2,068.00, difference −₹2.00; billing stops', async () => {
    const shift = (await owner.get(`/pos/till/${tillId}/shift`).expect(200)).body;
    await T(owner.post(`/pos/shifts/${shift.id}/cash-movements`)).send({ clientId: randomUUID(), direction: 'out', amount: '200', reason: 'Tea and snacks' }).expect(201);
    const before = (await owner.get(`/pos/till/${tillId}/shift`).expect(200)).body;
    expect(before.expected.find((e: { paymentMethodId: string }) => e.paymentMethodId === pm.CASH).expected).toBe('2070.00');
    const closed = (await T(owner.post(`/pos/shifts/${shift.id}/close`)).send({ denominations: { '500': 4, '20': 3, '5': 1, '2': 1, '1': 1 } }).expect(200)).body;
    const cash = closed.expected.find((e: { paymentMethodId: string }) => e.paymentMethodId === pm.CASH);
    expect(cash).toMatchObject({ expected: '2070.00', counted: '2068.00', difference: '-2.00' });
    expect(closed.closing).toMatchObject({ salesTotal: '522.00', returnsTotal: '-252.00' });
    expect(closed.closing.summary).toMatchObject({ cost_of_goods_sold: '200.00', cash_in_till: '398.00', change_given: '-128.00' });
    expect((await T(owner.post('/pos/bills')).send(sale([{ itemId: basmati.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '120' }])).expect(400)).body.message).toMatch(/Open a shift/);
  });
});

describe('6.4 selling beyond stock, 6.6 card and UPI, 6.7 never saved twice', () => {
  let tea: { id: string };
  let atta: { id: string };
  beforeAll(async () => {
    await freshTill();
    tea = await item('Tea 250 g', '0902', '150');
    atta = await item('Aashirvaad Atta 10 kg', '1101', '899');
    await opening(tea.id, '1', '100');
    await opening(atta.id, '10', '700');
    await openShift(owner);
  });
  afterAll(expectConsistent);

  it('6.4 3 sold with 1 in stock: allowed, −2 and flagged; the back office still refuses', async () => {
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: tea.id, quantity: '3' }], [{ paymentMethodId: pm.CASH, amount: '450' }])).expect(201)).body;
    expect(res.sale.checkFlags).toContain('stock_negative');
    expect(await position(tea.id)).toMatchObject({ q: '-2' });
    const negative = (await owner.get('/stock/exceptions/negative').expect(200)).body;
    expect(JSON.stringify(negative)).toContain(tea.id);
    const wo = (await owner.post('/stock/documents').send({ kind: 'stock_out', reason: 'damage', storeId: MAIN, fromLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: tea.id, quantity: '1' }] }).expect(201)).body;
    await owner.post(`/stock/documents/${wo.id}/finalise`).expect(400);
  });

  it('6.6 ₹899 paid by card and UPI, with references; neither counts as cash', async () => {
    const noRef = sale([{ itemId: atta.id, quantity: '1' }], [{ paymentMethodId: pm.CARD, amount: '899' }]);
    expect((await T(owner.post('/pos/bills')).send(noRef).expect(400)).body.message).toMatch(/Card needs the approval code/);
    n--;
    await T(owner.post('/pos/bills'))
      .send(sale([{ itemId: atta.id, quantity: '1' }], [{ paymentMethodId: pm.CARD, amount: '500', reference: '482913' }, { paymentMethodId: pm.UPI, amount: '399', reference: 'UPI-5512090' }]))
      .expect(201);
    const report = (await owner.get(`/pos/reports/payments?from=${today()}&to=${today()}`).expect(200)).body;
    expect(report.map((r: { method: string; amount: string }) => [r.method, r.amount])).toEqual(expect.arrayContaining([['Card', '500.00'], ['UPI', '399.00']]));
    const shift = (await owner.get(`/pos/till/${tillId}/shift`).expect(200)).body;
    expect(shift.expected.find((e: { paymentMethodId: string }) => e.paymentMethodId === pm.CASH).expected).toBe('2450.00'); // 2000 + the tea sale only
  });

  it('6.7 the same bill sent 5 times is saved once; numbers must be the till’s own', async () => {
    const body = sale([{ itemId: atta.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '900' }]);
    const results = await Promise.all([1, 2, 3].map(() => T(owner.post('/pos/bills')).send(body)));
    const later = [await T(owner.post('/pos/bills')).send(body), await T(owner.post('/pos/bills')).send(body)];
    const all = [...results, ...later];
    expect(all.every((r) => r.status === 201)).toBe(true);
    expect(new Set(all.map((r) => r.body.sale.id)).size).toBe(1);
    expect(all.filter((r) => r.body.repeated === false)).toHaveLength(1);
    expect(await prisma.posBill.count({ where: { clientId: body.clientId } })).toBe(1);
    expect(await prisma.stockLedgerEntry.count({ where: { documentId: all[0].body.sale.id } })).toBe(1);
    expect(await prisma.posPayment.count({ where: { bill: { clientId: body.clientId } } })).toBe(1);
    expect(await position(atta.id)).toMatchObject({ q: '8' });
    const foreign = { ...sale([{ itemId: atta.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '899' }]) };
    foreign.sale.number = 'MAT2/2627/000001';
    expect((await T(owner.post('/pos/bills')).send(foreign).expect(400)).body.message).toMatch(/not in this till’s series/);
    // Without the registered computer's token nothing is accepted.
    await owner.post('/pos/bills').send(sale([{ itemId: atta.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '899' }])).expect(401);
  });
});

describe('6.8 discount limits with a manager PIN (decisions 19, 40, 76)', () => {
  let soap: { id: string };
  let cashier: Agent;
  let managerId: string;
  beforeAll(async () => {
    await freshTill();
    soap = await item('Dove Soap 100 g', '3402', '100', { mrp: '100', maxDiscountPercent: '15' });
    await opening(soap.id, '50', '60');
    const c = await staff('Kavya', 'kavya@rademics.test', 'cashier');
    cashier = c.agent;
    const m = await staff('Priya', 'priya@rademics.test', 'store_manager');
    managerId = m.id;
    await cashier.post('/pos/pin').send({ pin: '4826', currentPassword: 'Own-pass-12345' }).expect(200);
    await m.agent.post('/pos/pin').send({ pin: '7391', currentPassword: 'Own-pass-12345' }).expect(200);
    await openShift(cashier);
  });

  it('5% by the cashier; 12% needs the manager; above 15% or above MRP never', async () => {
    const pay = (amt: string) => [{ paymentMethodId: pm.CASH, amount: amt }];
    await T(cashier.post('/pos/bills')).send(sale([{ itemId: soap.id, quantity: '1', discountPercent: '5' }], pay('95'))).expect(201);
    expect((await T(cashier.post('/pos/bills')).send(sale([{ itemId: soap.id, quantity: '1', discountPercent: '12' }], pay('88'))).expect(403)).body.message).toMatch(/manager must approve/);
    n--;
    await cashier.post('/pos/approvals').send({ tillId, managerId, pin: '0000', action: 'discount' }).expect(401);
    const { token } = (await cashier.post('/pos/approvals').send({ tillId, managerId, pin: '7391', action: 'discount', details: 'Dove 12%' }).expect(200)).body;
    const ok = (await T(cashier.post('/pos/bills')).send(sale([{ itemId: soap.id, quantity: '1', discountPercent: '12', approvalToken: token }], pay('88'))).expect(201)).body;
    expect(ok.sale.lines[0]).toMatchObject({ discountPercent: '12.00', lineTotal: '88.00', approvedById: managerId });
    // The approval is used once.
    expect((await T(cashier.post('/pos/bills')).send(sale([{ itemId: soap.id, quantity: '1', discountPercent: '12', approvalToken: token }], pay('88'))).expect(403)).body.message).toMatch(/already used/);
    n--;
    const t2 = (await cashier.post('/pos/approvals').send({ tillId, managerId, pin: '7391', action: 'discount' }).expect(200)).body.token;
    expect((await T(cashier.post('/pos/bills')).send(sale([{ itemId: soap.id, quantity: '1', discountPercent: '20', approvalToken: t2 }], pay('80'))).expect(400)).body.message).toMatch(/maximum of 15.00%/);
    n--;
    const t3 = (await cashier.post('/pos/approvals').send({ tillId, managerId, pin: '7391', action: 'price_change' }).expect(200)).body.token;
    expect((await T(cashier.post('/pos/bills')).send(sale([{ itemId: soap.id, quantity: '1', price: '101', approvalToken: t3 }], pay('101'))).expect(400)).body.message).toMatch(/above the MRP 100.00/);
    n--;
  });

  it('offline, 12% is accepted only with the approval the till got before the connection dropped', async () => {
    const pay = [{ paymentMethodId: pm.CASH, amount: '88' }];
    const line = { itemId: soap.id, quantity: '1', discountPercent: '12', charged: { listPrice: '100', price: '100', discountAmount: '12', gstRate: '18', lineTotal: '88' } };
    const offline = { offline: true, shiftClientId, soldAt: new Date(Date.now() - 60_000).toISOString() };
    await T(cashier.post('/pos/bills')).send(sale([line], pay, offline)).expect(400);
    n--;
    const { token } = (await cashier.post('/pos/approvals').send({ tillId, managerId, pin: '7391', action: 'discount' }).expect(200)).body;
    const res = (await T(cashier.post('/pos/bills')).send(sale([{ ...line, approvalToken: token }], pay, offline)).expect(201)).body;
    expect(res.sale).toMatchObject({ total: '88.00', offline: true });
    expect(res.sale.lines[0]).toMatchObject({ approvedById: managerId });
  });
});

describe('6.9 offers and coupons (decision 17), 6.10 expired batch, 6.11 offline bill at an old price', () => {
  let parle: { id: string };
  let biscuits: string;
  let ghee: { id: string };
  let rice: { id: string };
  let managerAgent: Agent;
  let managerId: string;
  beforeAll(async () => {
    await freshTill();
    biscuits = (await owner.post('/catalogue/item-groups').send({ code: 'BISC', name: 'Biscuits' }).expect(201)).body.id;
    parle = (await owner.post('/items').send({ name: 'Parle-G 250 g', itemGroupId: biscuits, baseUnitId: pcs, hsnCode: '1905' }).expect(201)).body;
    await owner.post('/prices').send({ priceListId: listId, itemId: parle.id, price: '30', startDate: '2026-04-01' }).expect(201);
    await opening(parle.id, '100', '20');
    ghee = await item('Cow Ghee 500 ml', '0405', '320', { trackBatches: true });
    await owner.post('/pos/gst-rates').send({ hsnCode: '0405', rate: '12', effectiveFrom: '2026-04-01' }).expect(201);
    rice = await item('Sona Masoori 1 kg', '1006', '120');
    await opening(rice.id, '30', '80');
    const m = await staff('Priya', 'priya@rademics.test', 'store_manager');
    managerAgent = m.agent;
    managerId = m.id;
    await managerAgent.post('/pos/pin').send({ pin: '7391', currentPassword: 'Own-pass-12345' }).expect(200);
    await openShift(owner);
  });
  afterAll(expectConsistent);

  it('6.9 buy 2 get 1 free beats 10% off; a coupon is used once and given back on cancel', async () => {
    const base = { kind: 'free_goods', appliesTo: 'items', targetIds: [parle.id], buyQuantity: '2', freeQuantity: '1', startDate: '2026-04-01' };
    await owner.post('/pos/offers').send({ code: 'PARLE-B2G1', name: 'Parle-G buy 2 get 1', ...base }).expect(201);
    await owner.post('/pos/offers').send({ code: 'BISC10', name: '10% off biscuits', kind: 'percent', value: '10', appliesTo: 'groups', targetIds: [biscuits], startDate: '2026-04-01' }).expect(201);
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: parle.id, quantity: '4' }], [{ paymentMethodId: pm.CASH, amount: '120' }])).expect(201)).body;
    expect(res.sale.total).toBe('120.00');
    const free = res.sale.lines.find((l: { isFree: boolean }) => l.isFree);
    expect(free).toMatchObject({ quantity: '2', lineTotal: '0.00' });
    expect(await position(parle.id)).toMatchObject({ q: '94' });

    const offer = (await owner.post('/pos/offers').send({ code: 'WELCOME5', name: '₹5 off with coupon', kind: 'amount', value: '5', appliesTo: 'bill', couponOnly: true, startDate: '2026-04-01' }).expect(201)).body;
    await owner.post('/pos/coupons').send({ code: 'HELLO-2026', offerId: offer.id, startDate: '2026-04-01', maxUses: 1 }).expect(201);
    const withCoupon = (await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '115' }], { couponCode: 'HELLO-2026' })).expect(201)).body;
    expect(withCoupon.sale.total).toBe('115.00');
    expect((await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '115' }], { couponCode: 'HELLO-2026' })).expect(400)).body.message).toMatch(/used up/);
    n--;
    const { token } = (await owner.post('/pos/approvals').send({ tillId, managerId, pin: '7391', action: 'cancel_bill' }).expect(200)).body;
    await owner.post(`/pos/bills/${withCoupon.sale.id}/cancel`).send({ reason: 'Customer changed mind', approvalToken: token }).expect(200);
    await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '115' }], { couponCode: 'HELLO-2026' })).expect(201);
  });

  it('6.10 the earliest unexpired batch is picked; an expired batch is refused for everyone', async () => {
    const stockIn = async (batchNumber: string, expiryDate: string) => {
      const d = (await owner.post('/stock/documents').send({ kind: 'stock_in', reason: 'found', storeId: MAIN, toLocationId: loc['MAIN-FLOOR'], lines: [{ itemId: ghee.id, quantity: '5', unitCost: '250', batchNumber, expiryDate }] }).expect(201)).body;
      await owner.post(`/stock/documents/${d.id}/finalise`).expect(200);
    };
    await stockIn('GH-LATE', addDays(today(), 60));
    await stockIn('GH-SOON', addDays(today(), 10));
    const soon = await prisma.batch.findFirstOrThrow({ where: { batchNumber: 'GH-SOON' } });
    const late = await prisma.batch.findFirstOrThrow({ where: { batchNumber: 'GH-LATE' } });
    const first = (await T(owner.post('/pos/bills')).send(sale([{ itemId: ghee.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '320' }])).expect(201)).body;
    expect(first.sale.lines[0].batchId).toBe(soon.id);
    await prisma.batch.update({ where: { id: soon.id }, data: { expiryDate: new Date(`${addDays(today(), -1)}T00:00:00Z`) } });
    const next = (await T(owner.post('/pos/bills')).send(sale([{ itemId: ghee.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '320' }])).expect(201)).body;
    expect(next.sale.lines[0].batchId).toBe(late.id);
    expect((await T(managerAgent.post('/pos/bills')).send(sale([{ itemId: ghee.id, quantity: '1', batchId: soon.id }], [{ paymentMethodId: pm.CASH, amount: '320' }])).expect(400)).body.message).toMatch(/expired on/);
  });

  it('6.11 a bill made offline at ₹120 after the price went to ₹125 is accepted as sold and flagged', async () => {
    await owner.post('/prices').send({ priceListId: listId, itemId: rice.id, price: '125', startDate: today() }).expect(201);
    const offline = sale(
      [{ itemId: rice.id, quantity: '1', charged: { listPrice: '120', price: '120', discountAmount: '0', gstRate: '5', lineTotal: '120' } }],
      [{ paymentMethodId: pm.CASH, amount: '120' }],
      { offline: true, shiftClientId, soldAt: new Date(Date.now() - 5 * 60_000).toISOString() },
    );
    const res = (await T(owner.post('/pos/bills')).send(offline).expect(201)).body;
    expect(res.sale).toMatchObject({ total: '120.00', offline: true });
    expect(res.sale.checkFlags).toContain('price_changed');
    const check = (await owner.get(`/pos/reports/offline-check?from=${today()}&to=${today()}`).expect(200)).body;
    expect(check.map((b: { id: string }) => b.id)).toContain(res.sale.id);
  });

  it('the till’s saved copy says how its price list works and carries real price ids', async () => {
    const snap = (await T(owner.get(`/pos/till/${tillId}/snapshot`)).expect(200)).body;
    expect(snap.till).toMatchObject({ priceListId: listId, pricesPerUnit: false });
    expect(snap.till).toHaveProperty('fallbackPriceList');
    const ricePrices = snap.prices.filter((p: { itemId: string }) => p.itemId === rice.id);
    expect(ricePrices.length).toBeGreaterThan(0);
    expect(ricePrices.every((p: { id: string; priceListId: string }) => p.id && p.priceListId === listId)).toBe(true);
  });
});

describe('go-live switch (plan 06 answer 1)', () => {
  beforeAll(() => freshTill());

  it('only the Owner switches tills live, with no GST approval step; an old provisional bill is returned with its flag', async () => {
    // Owner decision of 22 Oct 2026: a rate applies as soon as it is saved, so this bill is real GST.
    const soap = await item('Lux Soap', '3402', '40');
    await opening(soap.id, '10', '25');
    await openShift(owner);
    const firstBill = (await T(owner.post('/pos/bills')).send(sale([{ itemId: soap.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '40' }])).expect(201)).body;
    expect(firstBill.sale.gstProvisional).toBe(false);
    expect(firstBill.sale.checkFlags).not.toContain('gst_provisional');
    const acct = await staff('Ravi', 'ravi@rademics.test', 'accountant');
    await acct.agent.patch('/pos/settings').send({ liveAllowed: true }).expect(403);
    await owner.patch('/pos/settings').send({ liveAllowed: true }).expect(200);
    // Once live every rate in the list can be used.
    const rice = await item('Ponni Rice 1 kg', '1006', '70');
    await opening(rice.id, '10', '50');
    await T(owner.post('/pos/bills')).send(sale([{ itemId: rice.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '70' }])).expect(201);
    await T(owner.post('/pos/bills')).send(sale([{ itemId: soap.id, quantity: '1' }], [{ paymentMethodId: pm.CASH, amount: '40' }])).expect(201);
    // A bill saved as provisional before the change (simulated here) keeps that as history; its return copies the flag.
    await prisma.posBill.update({ where: { id: firstBill.sale.id }, data: { gstProvisional: true } });
    const back = { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), ret: { number: num(), returnOfId: firstBill.sale.id, lines: [{ lineNo: 1, itemId: soap.id, quantity: '1', returnOfLineId: firstBill.sale.lines[0].id }] }, payments: [{ paymentMethodId: pm.CASH, amount: '-40' }] };
    const res = (await T(owner.post('/pos/bills')).send(back).expect(201)).body;
    expect(res.return).toMatchObject({ total: '-40.00', gstProvisional: true });
    expect(res.return.checkFlags).toContain('gst_provisional');
    void OWNER;
  });
});
