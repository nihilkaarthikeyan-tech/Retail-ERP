// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 11":
// 11.12 new offers, 11.13 home delivery and 11.14 salesperson (plan 11 B3, B4, C1).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { businessDate } from 'shared';
import { StockReportsService } from '../../src/inventory/stock-reports.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { type Agent, createTestApp, login, OWNER, roleId, setUpCompany, storeId } from '../helpers.js';

let app: INestApplication<App>;
let prisma: PrismaService;
let owner: Agent;
let MAIN: string;
let loc: Record<string, string>;
let pcs: string;
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

interface Line {
  id: string;
  lineNo: number;
  item: { id: string; code: string };
  quantity: string;
  isFree: boolean;
  lineTotal: string;
  offerDiscount: string;
  offerId: string | null;
  offerName: string | null;
  salesStaffId: string | null;
  costValue?: string;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

async function freshCompany() {
  owner = await setUpCompany(app, prisma);
  n = 0;
  MAIN = await storeId(prisma, 'MAIN');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findUniqueOrThrow({ where: { code: 'PCS' } })).id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  await owner.post('/pos/gst-rates').send({ hsnCode: '6109', rate: '5', effectiveFrom: '2026-04-01' }).expect(201);
  await owner.post('/pos/gst-rates').send({ hsnCode: '6205', rate: '5', effectiveFrom: '2026-04-01' }).expect(201);
  await owner.post('/pos/gst-rates').send({ hsnCode: '4203', rate: '12', effectiveFrom: '2026-04-01' }).expect(201);
  await owner.post('/pos/gst-rates').send({ hsnCode: '9965', rate: '18', effectiveFrom: '2026-04-01' }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  const till = (
    await owner
      .post('/pos/tills')
      .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: [{ paymentMethodId: pm.CASH, isDefault: true }, { paymentMethodId: pm.CARD }] })
      .expect(201)
  ).body;
  tillId = till.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
  ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } })).id;
  await owner.post('/pos/pin').send({ pin: '7391', currentPassword: OWNER.password }).expect(200);
}

async function group(code: string, name: string) {
  return (await owner.post('/catalogue/item-groups').send({ code, name }).expect(201)).body.id as string;
}

async function item(name: string, groupId: string, hsnCode: string, price: string | null, extra: Record<string, unknown> = {}) {
  const i = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode, ...extra }).expect(201)).body as { id: string; code: string };
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

const cash = (amount: string) => [{ paymentMethodId: pm.CASH, amount }];

async function position(itemId: string) {
  const p = await prisma.stockPosition.findUnique({ where: { itemId_locationId: { itemId, locationId: loc['MAIN-FLOOR'] } } });
  return p?.quantity.toString() ?? '0';
}

async function person(firstName: string, email: string, role: string) {
  await owner.post('/users').send({ firstName, email, temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, role)], storeIds: [MAIN] }).expect(201);
  const a = await login(app, email, 'Temp-pass-1234');
  await a.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
  return { agent: a, id: (await prisma.user.findUniqueOrThrow({ where: { email } })).id };
}

async function expectConsistent() {
  expect(await app.get(StockReportsService).consistencyProblems()).toEqual([]);
}

describe('11.12 new offers (B3)', () => {
  let tees: { id: string }[];
  let topA: { id: string };
  let topB: { id: string };
  let shirt: { id: string };
  let belt: { id: string };
  let teesGroup: string;
  let offers: Record<string, string>;

  beforeAll(async () => {
    await freshCompany();
    teesGroup = await group('TEES', 'T-shirts');
    const tops = await group('TOPS', 'Tops');
    const shirts = await group('SHIRTS', 'Shirts');
    const belts = await group('BELTS', 'Belts');
    const tee = (name: string) => item(name, teesGroup, '6109', '399', { maxDiscountPercent: '20' });
    tees = [await tee('Round-neck tee, red'), await tee('Round-neck tee, blue'), await tee('Round-neck tee, black')];
    topA = await item('Rayon top', tops, '6109', '599');
    topB = await item('Cotton top', tops, '6109', '499');
    shirt = await item('Formal shirt', shirts, '6205', '1299');
    belt = await item('Leather belt', belts, '4203', '299');
    for (const t of tees) await opening(t.id, '20', '200');
    await opening(topA.id, '10', '300');
    await opening(topB.id, '10', '250');
    await opening(shirt.id, '10', '700');
    await opening(belt.id, '10', '120');
    const base = { appliesTo: 'groups', startDate: '2026-04-01' };
    offers = {
      ANY3: (await owner.post('/pos/offers').send({ ...base, code: 'TEES-ANY3', name: 'Any 3 tees for ₹999', kind: 'mix_match', targetIds: [teesGroup], setQuantity: 3, setPrice: '999' }).expect(201)).body.id,
      CHEAPEST: (await owner.post('/pos/offers').send({ ...base, code: 'TOPS-B2CF', name: 'Buy 2 tops, cheapest free', kind: 'mix_match', targetIds: [tops], setQuantity: 2, cheapestFree: true }).expect(201)).body.id,
      BELT: (await owner.post('/pos/offers').send({ code: 'SHIRT-BELT', name: 'Buy a shirt, get a belt free', kind: 'buy_get', appliesTo: 'items', targetIds: [shirt.id], buyQuantity: '1', freeQuantity: '1', freeItemId: belt.id, startDate: '2026-04-01' }).expect(201)).body.id,
    };
    await openShift();
  });
  afterAll(expectConsistent);

  it('an offer needs its own fields: a set price or "cheapest free", the free item', async () => {
    const base = { appliesTo: 'groups', targetIds: [teesGroup], startDate: '2026-04-01' };
    expect((await owner.post('/pos/offers').send({ ...base, code: 'BAD1', name: 'No price', kind: 'mix_match', setQuantity: 3 }).expect(400)).body.errors[0].message).toMatch(/set price/);
    expect((await owner.post('/pos/offers').send({ ...base, code: 'BAD2', name: 'Both', kind: 'mix_match', setQuantity: 3, setPrice: '999', cheapestFree: true }).expect(400)).body.errors[0].message).toMatch(/set price/);
    expect((await owner.post('/pos/offers').send({ ...base, code: 'BAD3', name: 'No free item', kind: 'buy_get', buyQuantity: '1', freeQuantity: '1' }).expect(400)).body.errors[0].message).toMatch(/item given free/);
    const listed = (await owner.get('/pos/offers').expect(200)).body.offers.find((o: { code: string }) => o.code === 'TEES-ANY3');
    expect(listed).toMatchObject({ kind: 'mix_match', setQuantity: 3, setPrice: '999.00', cheapestFree: false });
  });

  it('any 3 for ₹999: three tees total ₹999.00 with ₹198.00 spread over the lines; four total ₹1,398.00', async () => {
    const three = (await T(owner.post('/pos/bills')).send(sale(tees.map((t) => ({ itemId: t.id, quantity: '1' })), cash('999'), { expectedTotal: '999.00' })).expect(201)).body;
    expect(three.sale.total).toBe('999.00');
    expect(three.sale.lines.map((l: Line) => [l.offerDiscount, l.lineTotal, l.offerName])).toEqual([
      ['66.00', '333.00', 'Any 3 tees for ₹999'],
      ['66.00', '333.00', 'Any 3 tees for ₹999'],
      ['66.00', '333.00', 'Any 3 tees for ₹999'],
    ]);
    expect(three.sale.offers).toEqual([{ id: offers.ANY3, code: 'TEES-ANY3', name: 'Any 3 tees for ₹999', saving: '198.00' }]);
    expect(three.receipts[0].offers).toEqual([{ name: 'Any 3 tees for ₹999', saving: '198.00' }]);
    expect(three.receipts[0].lines[0]).toMatchObject({ offer: 'Any 3 tees for ₹999' });
    const four = (await T(owner.post('/pos/bills')).send(sale([{ itemId: tees[0].id, quantity: '2' }, { itemId: tees[1].id, quantity: '2' }], cash('1398'), { expectedTotal: '1398.00' })).expect(201)).body;
    expect(four.sale.total).toBe('1398.00');
  });

  it('an offline bill charged with the set price is accepted with no offer flag', async () => {
    const charged = (lineTotal: string, offerDiscount: string) => ({ listPrice: '399', price: '399', discountAmount: '0', offerDiscount, gstRate: '5', lineTotal });
    const body = sale(
      tees.map((t) => ({ itemId: t.id, quantity: '1', charged: charged('333', '66') })),
      cash('999'),
      { offline: true, shiftClientId, soldAt: new Date(Date.now() - 60_000).toISOString() },
    );
    const res = (await T(owner.post('/pos/bills')).send(body).expect(201)).body;
    expect(res.sale.total).toBe('999.00');
    expect(res.sale.checkFlags).not.toContain('offer_changed');
  });

  it('buy 2, cheapest free: the ₹499 top is free, the bill is ₹599.00; returning the ₹599 top refunds ₹599.00', async () => {
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: topA.id, quantity: '1' }, { itemId: topB.id, quantity: '1' }], cash('599'), { expectedTotal: '599.00' })).expect(201)).body;
    expect(res.sale.total).toBe('599.00');
    const [a, b] = res.sale.lines as Line[];
    expect([a.lineTotal, b.lineTotal, b.offerDiscount, b.offerId]).toEqual(['599.00', '0.00', '499.00', offers.CHEAPEST]);
    // The free top still leaves stock at its cost.
    expect(await position(topB.id)).toBe('9');
    expect(b.costValue).toBe('250.00');
    const back = (
      await T(owner.post('/pos/bills'))
        .send({ clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), ret: { number: num(), returnOfId: res.sale.id, lines: [{ lineNo: 1, itemId: topA.id, quantity: '1', returnOfLineId: a.id }] }, payments: cash('-599') })
        .expect(201)
    ).body;
    expect(back.return.total).toBe('-599.00');
    const left = await prisma.posBillLine.findUniqueOrThrow({ where: { id: b.id } });
    expect([left.returnedQuantity.toString(), left.lineTotal.toFixed(2)]).toEqual(['0', '0.00']);
  });

  it('buy a shirt, get a belt: the belt is added at ₹0 and leaves stock at its cost', async () => {
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], cash('1299'), { expectedTotal: '1299.00' })).expect(201)).body;
    expect(res.sale.total).toBe('1299.00');
    const free = (res.sale.lines as Line[]).find((l) => l.isFree)!;
    expect(free).toMatchObject({ item: { id: belt.id }, quantity: '1', lineTotal: '0.00', offerId: offers.BELT, costValue: '120.00' });
    expect(await position(belt.id)).toBe('9');
    expect(res.sale.offers).toEqual([{ id: offers.BELT, code: 'SHIRT-BELT', name: 'Buy a shirt, get a belt free', saving: '299.00' }]);
    expect(res.sale.costValue).toBe('820.00');
  });

  it('with several offers possible the bill gets the one that saves the most', async () => {
    await owner.post('/pos/offers').send({ code: 'TEES10', name: '10% off tees', kind: 'percent', value: '10', appliesTo: 'groups', targetIds: [teesGroup], startDate: '2026-04-01' }).expect(201);
    const mix = (await T(owner.post('/pos/bills')).send(sale(tees.map((t) => ({ itemId: t.id, quantity: '1' })), cash('999'))).expect(201)).body;
    expect(mix.sale.total).toBe('999.00');
    // 25% saves ₹299.25 on three tees, more than the set price's ₹198.
    const quarter = (await owner.post('/pos/offers').send({ code: 'TEES25', name: '25% off tees', kind: 'percent', value: '25', appliesTo: 'groups', targetIds: [teesGroup], startDate: '2026-04-01' }).expect(201)).body;
    const pct = (await T(owner.post('/pos/bills')).send(sale(tees.map((t) => ({ itemId: t.id, quantity: '1' })), cash('898'), { expectedTotal: '898.00' })).expect(201)).body;
    expect(pct.sale.total).toBe('898.00');
    expect((pct.sale.lines as Line[]).every((l) => l.offerId === quarter.id)).toBe(true);
    // A line with a typed price takes no offer; a line with a manual discount does not count towards a set.
    await owner.patch(`/pos/offers/${quarter.id}`).send({ code: 'TEES25', name: '25% off tees', kind: 'percent', value: '25', appliesTo: 'groups', targetIds: [teesGroup], startDate: '2026-04-01', active: false }).expect(200);
    const manual = (await T(owner.post('/pos/bills')).send(sale([...tees.slice(0, 2).map((t) => ({ itemId: t.id, quantity: '1' })), { itemId: tees[2].id, quantity: '1', discountPercent: '5' }], cash('1100'))).expect(201)).body;
    expect((manual.sale.lines as Line[]).map((l) => l.offerName)).toEqual(['10% off tees', '10% off tees', '10% off tees']);
  });
});

describe('11.13 home delivery (B4)', () => {
  let kurta: { id: string };
  let saree: { id: string };
  let deliveryItem: { id: string };
  let manager: { agent: Agent; id: string };
  let cashier: { agent: Agent; id: string };

  beforeAll(async () => {
    await freshCompany();
    const g = await group('ETHNIC', 'Ethnic wear');
    kurta = await item('Cotton kurta', g, '6205', '1500');
    saree = await item('Silk saree', g, '6205', '2500');
    await opening(kurta.id, '10', '900');
    await opening(saree.id, '10', '1600');
    const svc = await group('SERVICES', 'Services');
    deliveryItem = await item('Home delivery', svc, '9965', null, { isStockItem: false });
    const stockItem = await item('Gift box', svc, '4203', '50');
    manager = await person('Priya', 'priya@rademics.test', 'store_manager');
    cashier = await person('Ravi', 'ravi@rademics.test', 'cashier');
    await owner.patch(`/pos/stores/${MAIN}/delivery-charges`).send({ deliveryCharge: '50', deliveryFreeAbove: '2000' }).expect(200);
    expect((await owner.patch('/pos/settings').send({ deliveryItemId: stockItem.id }).expect(400)).body.message).toMatch(/service item/);
    await owner.patch('/pos/settings').send({ deliveryItemId: deliveryItem.id }).expect(200);
    await openShift();
  });

  const delivery = { name: 'Lakshmi', address: '12 Gandhi Street, Chennai 600017', phone: '9840012345', deliverOn: today() };

  it('a ₹1,500 bill with delivery adds a ₹50.00 line and shows in the pending deliveries; delivering records who and when', async () => {
    const charges = (await owner.get('/pos/delivery-charges').expect(200)).body;
    expect(charges).toEqual([expect.objectContaining({ code: 'MAIN', deliveryCharge: '50.00', deliveryFreeAbove: '2000.00' })]);
    const snap = (await T(owner.get(`/pos/till/${tillId}/snapshot`)).expect(200)).body;
    expect(snap.till.delivery).toEqual({ charge: '50.00', freeAbove: '2000.00', itemId: deliveryItem.id });

    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: kurta.id, quantity: '1' }], cash('1550'), { delivery, expectedTotal: '1550.00' })).expect(201)).body;
    expect(res.sale.total).toBe('1550.00');
    const charge = (res.sale.lines as Line[]).find((l) => l.item.id === deliveryItem.id)!;
    expect(charge).toMatchObject({ lineNo: 2, quantity: '1', lineTotal: '50.00' });
    expect(res.sale.delivery).toMatchObject({ status: 'pending', chargeAmount: '50.00', address: delivery.address, deliverOn: today() });
    expect(res.receipts[0].delivery).toMatchObject({ address: delivery.address });

    const pending = (await manager.agent.get(`/pos/deliveries?storeId=${MAIN}&status=pending`).expect(200)).body;
    expect(pending.rows.map((d: { bill: { id: string } }) => d.bill.id)).toEqual([res.sale.id]);
    const id = pending.rows[0].id as string;
    // A cashier cannot mark it; the manager can, once.
    await cashier.agent.post(`/pos/deliveries/${id}/delivered`).send({}).expect(403);
    const done = (await manager.agent.post(`/pos/deliveries/${id}/delivered`).send({ remarks: 'Handed to the customer' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'delivered', deliveredById: manager.id });
    expect(new Date(done.deliveredAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect((await manager.agent.post(`/pos/deliveries/${id}/delivered`).send({}).expect(400)).body.message).toMatch(/already delivered/);
    const delivered = (await manager.agent.get(`/pos/deliveries?status=delivered`).expect(200)).body.rows;
    expect(delivered[0]).toMatchObject({ deliveredBy: 'Priya', bill: { number: res.sale.number } });
    expect(await prisma.auditLog.count({ where: { entityType: 'pos_delivery', entityId: id } })).toBe(2);
  });

  it('a ₹2,500 bill has no delivery charge', async () => {
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: saree.id, quantity: '1' }], cash('2500'), { delivery, expectedTotal: '2500.00' })).expect(201)).body;
    expect(res.sale.total).toBe('2500.00');
    expect(res.sale.lines).toHaveLength(1);
    expect(res.sale.delivery).toMatchObject({ status: 'pending', chargeAmount: '0.00' });
  });

  it('cancelling the bill cancels its delivery; an offline bill keeps the charge the till added', async () => {
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: kurta.id, quantity: '1' }], cash('1550'), { delivery })).expect(201)).body;
    const token = (await owner.post('/pos/approvals').send({ tillId, managerId: ownerId, pin: '7391', action: 'cancel_bill' }).expect(200)).body.token;
    await owner.post(`/pos/bills/${res.sale.id}/cancel`).send({ reason: 'Customer will collect', approvalToken: token }).expect(200);
    expect((await prisma.posDelivery.findUniqueOrThrow({ where: { billId: res.sale.id } })).status).toBe('cancelled');

    const offline = sale(
      [{ itemId: kurta.id, quantity: '1', charged: { listPrice: '1500', price: '1500', discountAmount: '0', gstRate: '5', lineTotal: '1500' } }],
      cash('1550'),
      { offline: true, shiftClientId, soldAt: new Date(Date.now() - 60_000).toISOString(), delivery: { ...delivery, charge: '50' } },
    );
    const kept = (await T(cashier.agent.post('/pos/bills')).send(offline).expect(201)).body;
    expect(kept.sale).toMatchObject({ total: '1550.00', offline: true, delivery: { chargeAmount: '50.00' } });
    expect(kept.sale.checkFlags).not.toContain('delivery_charge_changed');
  });

  it('a return alone cannot carry a delivery', async () => {
    const body = { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), ret: { number: num(), lines: [{ lineNo: 1, itemId: kurta.id, quantity: '1' }] }, payments: cash('-1500'), delivery };
    expect((await T(owner.post('/pos/bills')).send(body).expect(400)).body.errors[0].message).toMatch(/Home delivery is for a sale/);
    n--;
  });
});

describe('11.14 salesperson (C1)', () => {
  let shirt: { id: string };
  let trousers: { id: string };
  let socks: { id: string };
  let priya: { id: string };
  let arun: { id: string };

  beforeAll(async () => {
    await freshCompany();
    const g = await group('MENS', 'Menswear');
    shirt = await item('Formal shirt', g, '6205', '1299');
    trousers = await item('Chinos', g, '6205', '1499');
    socks = await item('Cotton socks', g, '6205', '149.50');
    for (const i of [shirt, trousers, socks]) await opening(i.id, '20', '400');
    await openShift();
  });

  it('a manager keeps the store’s sales staff; codes are unique per store and staff need no login', async () => {
    const m = await person('Meena', 'meena@rademics.test', 'store_manager');
    const c = await person('Ravi', 'ravi@rademics.test', 'cashier');
    priya = (await m.agent.post('/sales-staff').send({ storeId: MAIN, code: 'p1', name: 'Priya' }).expect(201)).body;
    arun = (await m.agent.post('/sales-staff').send({ storeId: MAIN, code: 'A1', name: 'Arun' }).expect(201)).body;
    expect(priya).toMatchObject({ code: 'P1', active: true });
    expect((await m.agent.post('/sales-staff').send({ storeId: MAIN, code: 'A1', name: 'Anand' }).expect(409)).body.message).toMatch(/already used by Arun/);
    await c.agent.post('/sales-staff').send({ storeId: MAIN, code: 'R1', name: 'Ravi' }).expect(403);
    expect((await c.agent.get(`/sales-staff?storeId=${MAIN}&active=true`).expect(200)).body.map((s: { code: string }) => s.code)).toEqual(['A1', 'P1']);
    const snap = (await T(owner.get(`/pos/till/${tillId}/snapshot`)).expect(200)).body;
    expect(snap.salesStaff).toEqual([
      { id: arun.id, code: 'A1', name: 'Arun' },
      { id: priya.id, code: 'P1', name: 'Priya' },
    ]);
    // Someone from another store cannot be named on this store's bill.
    const other = (await owner.post('/stores').send({ code: 'ANNEX', name: 'Annex' }).expect(201)).body;
    const away = (await owner.post('/sales-staff').send({ storeId: other.id, code: 'K1', name: 'Kumar' }).expect(201)).body;
    expect((await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }], cash('1299'), { salesStaffId: away.id })).expect(400)).body.message).toMatch(/not a salesperson of this store/);
    n--;
  });

  it('each line counts for its own salesperson; a return reduces the original line’s; the day’s total equals net sales', async () => {
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: shirt.id, quantity: '1' }, { itemId: trousers.id, quantity: '1', salesStaffId: arun.id }], cash('2798'), { salesStaffId: priya.id })).expect(201)).body;
    expect(res.sale.salesStaffId).toBe(priya.id);
    expect((res.sale.lines as Line[]).map((l) => l.salesStaffId)).toEqual([priya.id, arun.id]);
    expect(res.receipts[0].salesStaff).toBe('Priya');

    // A bill with paise: ₹149.50 rounds to ₹150.00; the rounding goes with Arun.
    await T(owner.post('/pos/bills')).send(sale([{ itemId: socks.id, quantity: '1' }], cash('150'), { salesStaffId: arun.id })).expect(201);

    const trouserLine = (res.sale.lines as Line[])[1];
    const back = (
      await T(owner.post('/pos/bills'))
        .send({ clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), ret: { number: num(), returnOfId: res.sale.id, lines: [{ lineNo: 1, itemId: trousers.id, quantity: '1', returnOfLineId: trouserLine.id }] }, payments: cash('-1499') })
        .expect(201)
    ).body;
    expect(back.return.lines[0].salesStaffId).toBe(arun.id);
    expect(back.return.salesStaffId).toBe(priya.id);

    const report = (await owner.get(`/pos/reports/by-salesperson?from=${today()}&to=${today()}`).expect(200)).body as { period: string; name: string; sales: string; returnsAmount: string; net: string; bills: number; returns: number }[];
    const row = (name: string) => report.find((r) => r.name === name)!;
    expect(row('Priya')).toMatchObject({ period: today(), sales: '1299.00', returnsAmount: '0.00', net: '1299.00', bills: 1, returns: 0 });
    expect(row('Arun')).toMatchObject({ sales: '1649.00', returnsAmount: '-1499.00', net: '150.00', bills: 2, returns: 1 });
    const register = (await owner.get(`/pos/reports/register?from=${today()}&to=${today()}`).expect(200)).body as { total: string }[];
    const netSales = register.reduce((s, b) => s + Math.round(Number(b.total) * 100), 0);
    expect(report.reduce((s, r) => s + Math.round(Number(r.net) * 100), 0)).toBe(netSales);
    const month = (await owner.get(`/pos/reports/by-salesperson?from=${today()}&to=${today()}&groupBy=month`).expect(200)).body;
    expect(month.find((r: { name: string }) => r.name === 'Arun')).toMatchObject({ period: today().slice(0, 7), net: '150.00' });
  });

  it('offline, a salesperson switched off meanwhile is kept and flagged', async () => {
    await owner.patch(`/sales-staff/${arun.id}`).send({ active: false }).expect(200);
    const online = sale([{ itemId: shirt.id, quantity: '1' }], cash('1299'), { salesStaffId: arun.id });
    expect((await T(owner.post('/pos/bills')).send(online).expect(400)).body.message).toMatch(/switched off/);
    n--;
    const offline = sale([{ itemId: shirt.id, quantity: '1', charged: { listPrice: '1299', price: '1299', discountAmount: '0', gstRate: '5', lineTotal: '1299' } }], cash('1299'), {
      salesStaffId: arun.id,
      offline: true,
      shiftClientId,
      soldAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const kept = (await T(owner.post('/pos/bills')).send(offline).expect(201)).body;
    expect(kept.sale.salesStaffId).toBe(arun.id);
    expect(kept.sale.checkFlags).toContain('sales_staff_changed');
  });
});
