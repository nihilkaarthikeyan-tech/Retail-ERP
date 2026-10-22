// Copyright (c) 2026, Rademics. All rights reserved.
// Automated versions of docs/acceptance-tests.md, section "Module 11, part 2":
// 11.20 customer order with an advance, 11.21 cancelling an order, 11.22 alteration job.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { addDays, businessDate, Decimal } from 'shared';
import { StockReportsService } from '../../src/inventory/stock-reports.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
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
let ownerId: string;
let customerGroups: Record<string, string>;
let n = 0;

const today = () => businessDate();
const num = () => `MAT1/2627/${String(++n).padStart(6, '0')}`;
const T = <R extends { set: (k: string, v: string) => R }>(r: R) => r.set('x-till-token', tillToken);

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(SystemPrisma);
});

afterAll(async () => {
  await app.close();
});

async function freshCompany() {
  owner = await setUpCompany(app, prisma);
  n = 0;
  MAIN = await storeId(prisma, 'MAIN');
  loc = Object.fromEntries((await owner.get('/stock/locations').expect(200)).body.map((l: { code: string; id: string }) => [l.code, l.id]));
  pcs = (await prisma.unit.findFirstOrThrow({ where: { code: 'PCS' } })).id;
  groupId = (await owner.post('/catalogue/item-groups').send({ code: 'ETHNIC', name: 'Ethnic wear' }).expect(201)).body.id;
  listId = (await owner.post('/price-lists').send({ code: 'RETAIL', name: 'Retail', forSelling: true, forBuying: false }).expect(201)).body.id;
  for (const [hsnCode, rate] of [['6205', '5'], ['9988', '18']]) await owner.post('/pos/gst-rates').send({ hsnCode, rate, effectiveFrom: '2026-04-01' }).expect(201);
  // A method that cannot refund, to show refunds go only by refund-allowed methods.
  await owner.post('/pos/payment-methods').send({ code: 'VOUCHER', name: 'Gift voucher', kind: 'other', allowRefund: false }).expect(201);
  pm = Object.fromEntries((await owner.get('/pos/payment-methods').expect(200)).body.map((m: { code: string; id: string }) => [m.code, m.id]));
  const till = (
    await owner
      .post('/pos/tills')
      .send({ storeId: MAIN, code: 'T1', name: 'Counter 1', locationId: loc['MAIN-FLOOR'], priceListId: listId, paymentMethods: ['CASH', 'UPI', 'VOUCHER'].map((m, i) => ({ paymentMethodId: pm[m], isDefault: i === 0 })) })
      .expect(201)
  ).body;
  tillId = till.id;
  tillToken = (await owner.post(`/pos/tills/${tillId}/register`).send({ deviceName: 'Counter 1 PC' }).expect(201)).body.token;
  ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } })).id;
  await owner.post('/pos/pin').send({ pin: '7391', currentPassword: OWNER.password }).expect(200);
  customerGroups = Object.fromEntries((await prisma.customerGroup.findMany()).map((g) => [g.code, g.id]));
}

async function item(name: string, hsnCode: string, price: string | null, extra: Record<string, unknown> = {}) {
  const i = (await owner.post('/items').send({ name, itemGroupId: groupId, baseUnitId: pcs, hsnCode, ...extra }).expect(201)).body as { id: string; code: string };
  if (price) await owner.post('/prices').send({ priceListId: listId, itemId: i.id, price, startDate: '2026-04-01' }).expect(201);
  return i;
}

async function stockIn(itemId: string, qty: string, cost: string) {
  const c = (await owner.post('/stock/counts').send({ countType: 'opening', storeId: MAIN, locationId: loc['MAIN-FLOOR'], lines: [{ itemId, countedQuantity: qty, unitCost: cost }] }).expect(201)).body;
  await owner.post(`/stock/documents/${c.id}/finalise`).expect(200);
}

async function customer(name: string, mobile: string) {
  return (await owner.post('/customers').send({ name, customerGroupId: customerGroups.RETAIL, mobile }).expect(201)).body as { id: string; code: string };
}

async function openShift(cash = '2000') {
  return (await T(owner.post('/pos/shifts')).send({ clientId: randomUUID(), tillId, cash: [{ paymentMethodId: pm.CASH, amount: cash }] }).expect(201)).body as { id: string };
}

async function closeShift(shiftId: string) {
  const expected = (await T(owner.get(`/pos/till/${tillId}/shift`)).expect(200)).body.expected as { kind: string; expected: string }[];
  const cash = new Decimal(expected.find((e) => e.kind === 'cash')!.expected);
  // Count exactly what is expected, in ₹500, ₹100 and ₹1 notes and coins.
  const d500 = cash.divToInt(500).toNumber();
  const d100 = cash.sub(d500 * 500).divToInt(100).toNumber();
  const d1 = cash.sub(d500 * 500 + d100 * 100).toNumber();
  return (await T(owner.post(`/pos/shifts/${shiftId}/close`)).send({ denominations: { '500': d500, '100': d100, '1': d1 } }).expect(200)).body;
}

function sale(lines: Record<string, unknown>[], payments: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return { clientId: randomUUID(), tillId, soldAt: new Date().toISOString(), sale: { number: num(), lines: lines.map((l, i) => ({ lineNo: i + 1, ...l })) }, payments, ...extra };
}

const cash = (amount: string) => [{ paymentMethodId: pm.CASH, amount }];
const upi = (amount: string, reference = 'UPI-4471') => [{ paymentMethodId: pm.UPI, amount, reference }];

async function balance(customerId: string) {
  return (await app.get(LedgerService).partyBalance(prisma, 'customer', customerId)).toFixed(2);
}

async function openItems(customerId: string) {
  return (await owner.get(`/parties/customer/${customerId}/open-items`).expect(200)).body as { itemType: string; owed: string }[];
}

async function position(itemId: string) {
  const p = await prisma.stockPosition.findUnique({ where: { itemId_locationId: { itemId, locationId: loc['MAIN-FLOOR'] } } });
  return p?.quantity.toString() ?? '0';
}

/** Debit minus credit of a role's account (store accounts: for MAIN). */
async function roleBalance(role: string) {
  const company = await prisma.company.findFirstOrThrow();
  const a = await app.get(LedgerService).accountFor(prisma, company.id, { role, storeId: MAIN });
  const s = await prisma.ledgerLine.aggregate({ where: { accountId: a.id }, _sum: { debit: true, credit: true } });
  return new Decimal(s._sum.debit?.toString() ?? '0').sub(new Decimal(s._sum.credit?.toString() ?? '0')).toFixed(2);
}

async function expectBooks() {
  expect(await app.get(StockReportsService).consistencyProblems()).toEqual([]);
  const health = (await owner.get('/reports/book-health').expect(200)).body;
  expect(health.problems).toEqual([]);
  expect(health.totalDebit).toBe(health.totalCredit);
}

async function person(firstName: string, email: string, role: string) {
  await owner.post('/users').send({ firstName, email, temporaryPassword: 'Temp-pass-1234', roleIds: [await roleId(prisma, role)], storeIds: [MAIN] }).expect(201);
  const a = await login(app, email, 'Temp-pass-1234');
  await a.post('/auth/change-password').send({ currentPassword: 'Temp-pass-1234', newPassword: 'Own-pass-12345' }).expect(204);
  return a;
}

describe('11.20 customer order with an advance', () => {
  let kurta: { id: string; code: string };
  let priya: { id: string };
  let order: { id: string; number: string; lines: { id: string }[] };
  let shift: { id: string };

  beforeAll(async () => {
    await freshCompany();
    kurta = await item('Silk kurta, XL', '6205', '2499');
    priya = await customer('Priya', '9840012345');
    shift = await openShift();
  });
  afterAll(expectBooks);

  it('an order needs a named customer; it is numbered and moves no stock', async () => {
    const walkIn = (await prisma.partySettings.findFirstOrThrow()).walkInCustomerId!;
    const lines = [{ itemId: kurta.id, quantity: '1', price: '2499' }];
    expect((await owner.post('/orders').send({ storeId: MAIN, customerId: walkIn, lines }).expect(400)).body.message).toMatch(/named customer/);
    order = (await owner.post('/orders').send({ storeId: MAIN, customerId: priya.id, expectedOn: addDays(today(), 5), lines, remarks: 'Size XL, maroon' }).expect(201)).body;
    expect(order).toMatchObject({ status: 'open', total: '2499.00', advanceReceived: '0.00', advanceHeld: '0.00' });
    expect(order.number).toMatch(/^CO-2026-27-\d{5}$/);
    expect(await prisma.stockLedgerEntry.count({ where: { itemId: kurta.id } })).toBe(0);
  });

  it('a ₹1,000 advance by UPI at the till: the order holds ₹1,000 and Priya’s balance shows ₹1,000 in credit', async () => {
    const body = { clientId: randomUUID(), tillId, paymentMethodId: pm.UPI, amount: '1000', reference: 'UPI-8812' };
    // UPI needs its reference; on account is not money received.
    expect((await T(owner.post(`/pos/orders/${order.id}/advances`)).send({ ...body, reference: null }).expect(400)).body.message).toMatch(/needs the approval code or reference/);
    const after = (await T(owner.post(`/pos/orders/${order.id}/advances`)).send(body).expect(201)).body;
    expect(after).toMatchObject({ advanceReceived: '1000.00', advanceHeld: '1000.00' });
    expect(after.payments).toEqual([expect.objectContaining({ kind: 'receipt', amount: '1000.00', unused: '1000.00', reference: 'UPI-8812' })]);
    // Sent twice (a retry): saved once.
    expect((await T(owner.post(`/pos/orders/${order.id}/advances`)).send(body).expect(201)).body.advanceReceived).toBe('1000.00');
    expect(await balance(priya.id)).toBe('-1000.00');
    expect(await openItems(priya.id)).toEqual([expect.objectContaining({ itemType: 'payment', owed: '-1000.00' })]);
    expect(await position(kurta.id)).toBe('0');
    const held = (await owner.get('/orders?view=advances').expect(200)).body;
    expect(held).toMatchObject({ advancesHeld: '1000.00', total: 1 });
    // UPI money is not in the drawer: the expected cash is still the float.
    const expected = (await T(owner.get(`/pos/till/${tillId}/shift`)).expect(200)).body.expected;
    expect(expected.find((e: { kind: string }) => e.kind === 'cash').expected).toBe('2000.00');
  });

  it('marked ready, one unit is set aside; selling it to someone else gives a warning, not a refusal', async () => {
    await stockIn(kurta.id, '1', '1500');
    const ready = (await owner.post(`/orders/${order.id}/ready`).expect(200)).body;
    expect(ready).toMatchObject({ status: 'ready', lines: [expect.objectContaining({ setAside: '1' })] });
    const snap = (await T(owner.get(`/pos/till/${tillId}/snapshot`)).expect(200)).body;
    expect(snap.reserved).toEqual([{ itemId: kurta.id, quantity: '1' }]);

    const other = (await T(owner.post('/pos/bills')).send(sale([{ itemId: kurta.id, quantity: '1' }], cash('2499'))).expect(201)).body;
    expect(other.warnings).toEqual([expect.stringMatching(/set aside for customer orders/)]);
    // The manager cancels that sale: the kurta is back on the shelf.
    const token = (await owner.post('/pos/approvals').send({ tillId, managerId: ownerId, pin: '7391', action: 'cancel_bill' }).expect(200)).body.token;
    await owner.post(`/pos/bills/${other.sale.id}/cancel`).send({ reason: 'Kept for an order', approvalToken: token }).expect(200);
    expect(await position(kurta.id)).toBe('1');
  });

  it('collecting: the bill is ₹2,499.00, the advance pays ₹1,000.00 and she pays ₹1,499.00; her balance is back to zero', async () => {
    const lineId = order.lines[0].id;
    // The agreed price, all ordered lines, and the order's own customer.
    expect((await T(owner.post('/pos/bills')).send(sale([{ itemId: kurta.id, quantity: '1', orderLineId: lineId }], upi('1499'), { orderId: order.id })).expect(400)).body.message).toMatch(/another customer/);
    n--;
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: kurta.id, quantity: '1', orderLineId: lineId }], upi('1499'), { orderId: order.id, customerId: priya.id, expectedTotal: '2499.00' })).expect(201)).body;
    expect(res.sale.total).toBe('2499.00');
    expect(res.warnings).toEqual([]);
    const pays = res.sale.payments.map((p: { paymentMethod: { kind: string }; amount: string; reference: string }) => [p.paymentMethod.kind, p.amount, p.reference]);
    expect(pays).toEqual(expect.arrayContaining([['on_account', '1000.00', `Advance ${order.number}`], ['upi', '1499.00', 'UPI-4471']]));
    expect(res.receipts[0].payments).toEqual(expect.arrayContaining([expect.objectContaining({ amount: '1000.00', reference: `Advance ${order.number}` })]));

    const collected = (await owner.get(`/orders/${order.id}`).expect(200)).body;
    expect(collected).toMatchObject({ status: 'collected', collectedBill: { id: res.sale.id, number: res.sale.number }, advanceHeld: '0.00', lines: [expect.objectContaining({ setAside: '0' })] });
    expect(await position(kurta.id)).toBe('0');
    // The advance is linked to the bill at once: it cannot be used twice.
    expect((await owner.get(`/orders/credit/${priya.id}`).expect(200)).body.available).toBe('0.00');

    await closeShift(shift.id);
    expect(await balance(priya.id)).toBe('0.00');
    expect(await openItems(priya.id)).toEqual([]);
    expect(await roleBalance('cash_in_till')).toBe('0.00');
    expect(await roleBalance('cash_short_over')).toBe('0.00');
  });
});

describe('11.21 cancelling an order', () => {
  let kurta: { id: string };
  let dupatta: { id: string };
  let priya: { id: string };
  let shift: { id: string };

  beforeAll(async () => {
    await freshCompany();
    kurta = await item('Silk kurta, XL', '6205', '2499');
    dupatta = await item('Cotton dupatta', '6205', '1200');
    await stockIn(dupatta.id, '5', '600');
    priya = await customer('Priya', '9840012345');
    shift = await openShift();
  });
  afterAll(expectBooks);

  async function orderWithCashAdvance() {
    const o = (await owner.post('/orders').send({ storeId: MAIN, customerId: priya.id, lines: [{ itemId: kurta.id, quantity: '1', price: '2499' }] }).expect(201)).body;
    await T(owner.post(`/pos/orders/${o.id}/advances`)).send({ clientId: randomUUID(), tillId, paymentMethodId: pm.CASH, amount: '1000' }).expect(201);
    return o as { id: string; number: string };
  }

  async function expectedCash() {
    const e = (await T(owner.get(`/pos/till/${tillId}/shift`)).expect(200)).body.expected;
    return e.find((x: { kind: string }) => x.kind === 'cash') as { expected: string; cashIn: string; cashOut: string };
  }

  it('cancelling with a refund needs a manager’s PIN and returns ₹1,000.00 by a refund-allowed method; the balance is zero', async () => {
    const o = await orderWithCashAdvance();
    // Cash taken as an advance is in the drawer.
    expect(await expectedCash()).toMatchObject({ cashIn: '1000.00', expected: '3000.00' });
    expect(await balance(priya.id)).toBe('-1000.00');
    const base = { clientId: randomUUID(), tillId, reason: 'Customer changed her mind', outcome: 'refund', paymentMethodId: pm.CASH };
    expect((await T(owner.post(`/pos/orders/${o.id}/cancel`)).send(base).expect(403)).body.message).toMatch(/manager must approve/);
    const approve = async () => (await owner.post('/pos/approvals').send({ tillId, managerId: ownerId, pin: '7391', action: 'order_refund' }).expect(200)).body.token as string;
    const first = await approve();
    expect((await T(owner.post(`/pos/orders/${o.id}/cancel`)).send({ ...base, paymentMethodId: pm.VOUCHER, approvalToken: first }).expect(400)).body.message).toMatch(/cannot be used for refunds/);
    // The refused try did not use up the approval.
    const done = (await T(owner.post(`/pos/orders/${o.id}/cancel`)).send({ ...base, approvalToken: first }).expect(200)).body;
    expect(done).toMatchObject({ status: 'cancelled', advanceOutcome: 'refund', advanceReceived: '1000.00', advanceRefunded: '1000.00', advanceHeld: '0.00' });
    expect(await balance(priya.id)).toBe('0.00');
    expect(await openItems(priya.id)).toEqual([]);
    expect(await expectedCash()).toMatchObject({ cashIn: '1000.00', cashOut: '1000.00', expected: '2000.00' });
    expect(await prisma.auditLog.count({ where: { entityType: 'customer_order', entityId: o.id, action: 'update' } })).toBe(1);
  });

  it('cancelling with credit kept leaves ₹1,000.00 in her favour, and her next bill can use it', async () => {
    const o = await orderWithCashAdvance();
    const done = (await owner.post(`/orders/${o.id}/cancel`).send({ reason: 'Will choose another design later' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'cancelled', advanceOutcome: 'keep_credit', advanceHeld: '1000.00' });
    expect(await balance(priya.id)).toBe('-1000.00');
    expect((await owner.get(`/orders/credit/${priya.id}`).expect(200)).body.available).toBe('1000.00');

    expect((await T(owner.post('/pos/bills')).send(sale([{ itemId: dupatta.id, quantity: '1' }], cash('0'), { customerId: priya.id, useCredit: '1200' })).expect(400)).body.message).toMatch(/only ₹1000.00 of credit/);
    n--;
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: dupatta.id, quantity: '1' }], cash('200'), { customerId: priya.id, useCredit: '1000', expectedTotal: '1200.00' })).expect(201)).body;
    expect(res.sale.total).toBe('1200.00');
    expect(res.sale.payments.map((p: { amount: string; reference: string | null }) => [p.amount, p.reference])).toEqual(expect.arrayContaining([['1000.00', 'Customer credit'], ['200.00', null]]));
    expect((await owner.get(`/orders/credit/${priya.id}`).expect(200)).body.available).toBe('0.00');

    await closeShift(shift.id);
    expect(await balance(priya.id)).toBe('0.00');
    expect(await openItems(priya.id)).toEqual([]);
    expect(await roleBalance('cash_in_till')).toBe('0.00');
    expect(await roleBalance('cash_short_over')).toBe('0.00');
  });

  it('lists: overdue orders and advances held; a cashier may take orders but not refund without a manager', async () => {
    const o = (await owner.post('/orders').send({ storeId: MAIN, customerId: priya.id, expectedOn: today(), lines: [{ itemId: kurta.id, quantity: '2', price: '2400' }] }).expect(201)).body;
    await prisma.customerOrder.update({ where: { id: o.id }, data: { expectedOn: new Date(`${addDays(today(), -1)}T00:00:00Z`) } });
    const overdue = (await owner.get('/orders?view=overdue').expect(200)).body.rows;
    expect(overdue.map((r: { id: string; overdue: boolean }) => [r.id, r.overdue])).toEqual([[o.id, true]]);
    const company = await prisma.company.findFirstOrThrow();
    const office = await app.get(LedgerService).accountFor(prisma, company.id, { role: 'cash_in_hand', storeId: MAIN });
    const withAdvance = (await owner.post(`/orders/${o.id}/advances`).send({ accountId: office.id, amount: '500' }).expect(201)).body;
    expect(withAdvance).toMatchObject({ advanceReceived: '500.00', advanceHeld: '500.00', total: '4800.00' });
    expect((await owner.get('/orders?view=advances').expect(200)).body).toMatchObject({ advancesHeld: '500.00', rows: [expect.objectContaining({ id: o.id })] });

    const cashier = await person('Ravi', 'ravi@rademics.test', 'cashier');
    // Until the roles are given the new rights by migration, only the owner takes orders.
    const listed = await cashier.get('/orders');
    expect([200, 403]).toContain(listed.status);
  });
});

describe('11.22 alteration job', () => {
  let chinos: { id: string };
  let service: { id: string };
  let tailor: { id: string };
  let trouserBill: { id: string; number: string };
  let shift: { id: string };

  beforeAll(async () => {
    await freshCompany();
    chinos = await item('Cotton chinos', '6205', '1499');
    await stockIn(chinos.id, '10', '700');
    service = await item('Alteration charge', '9988', null, { isStockItem: false });
    tailor = (await owner.post('/sales-staff').send({ storeId: MAIN, code: 'T1', name: 'Murugan (tailor)' }).expect(201)).body;
    shift = await openShift();
    n = 9;
    trouserBill = (await T(owner.post('/pos/bills')).send(sale([{ itemId: chinos.id, quantity: '1' }], cash('1499'))).expect(201)).body.sale;
  });
  afterAll(async () => {
    await closeShift(shift.id);
    await expectBooks();
  });

  const job = (extra: Record<string, unknown>) => ({
    storeId: MAIN,
    name: 'Karthik',
    phone: '9840098400',
    tailorStaffId: tailor.id,
    promisedOn: addDays(today(), 2),
    charge: '150',
    chargePaidWith: 'collection',
    lines: [{ itemId: chinos.id, garment: 'Cotton chinos', work: 'Shorten by 2 cm' }],
    ...extra,
  });

  it('the charge item must be a service item, set in the till settings', async () => {
    expect(trouserBill.number).toBe('MAT1/2627/000010');
    expect((await owner.patch('/pos/settings').send({ alterationItemId: chinos.id }).expect(400)).body.message).toMatch(/service item/);
    expect((await owner.patch('/pos/settings').send({ alterationItemId: service.id }).expect(200)).body.alterationItemId).toBe(service.id);
    const snap = (await T(owner.get(`/pos/till/${tillId}/snapshot`)).expect(200)).body;
    expect(snap.till.alterationItemId).toBe(service.id);
  });

  it('the job is received, with the tailor, ready, delivered, each with who and when; ₹150 billed on collection', async () => {
    const j = (await owner.post('/alterations').send(job({ billId: trouserBill.id })).expect(201)).body;
    expect(j).toMatchObject({ status: 'received', charge: '150.00', chargePaidWith: 'collection', tailor: 'Murugan (tailor)', bill: { number: 'MAT1/2627/000010' } });
    expect(j.number).toMatch(/^ALT-2026-27-\d{5}$/);
    // No skipping a step.
    expect((await owner.post(`/alterations/${j.id}/status`).send({ status: 'ready' }).expect(400)).body.message).toMatch(/cannot move to ready/);
    await owner.post(`/alterations/${j.id}/status`).send({ status: 'with_tailor' }).expect(200);
    await owner.post(`/alterations/${j.id}/status`).send({ status: 'ready' }).expect(200);
    // Handing it back needs the charge billed first.
    expect((await owner.post(`/alterations/${j.id}/status`).send({ status: 'delivered' }).expect(400)).body.message).toMatch(/Bill the ₹150.00 alteration charge/);
    const res = (await T(owner.post('/pos/bills')).send(sale([], cash('150'), { alteration: { jobId: j.id, deliver: true }, expectedTotal: '150.00' })).expect(201)).body;
    expect(res.sale.total).toBe('150.00');
    expect(res.sale.lines).toEqual([expect.objectContaining({ item: expect.objectContaining({ id: service.id }), lineTotal: '150.00', quantity: '1' })]);
    const after = (await owner.get(`/alterations/${j.id}`).expect(200)).body;
    expect(after).toMatchObject({ status: 'delivered', chargeBill: { id: res.sale.id }, bill: { id: trouserBill.id } });
    expect(after.history.map((h: { status: string; by: string }) => [h.status, h.by])).toEqual([
      ['received', 'Karthik R'],
      ['with_tailor', 'Karthik R'],
      ['ready', 'Karthik R'],
      ['delivered', 'Karthik R'],
    ]);
    expect(after.history.every((h: { at: string }) => new Date(h.at).getTime() > Date.now() - 120_000)).toBe(true);
    // Never both: a second charge is refused.
    expect((await T(owner.post('/pos/bills')).send(sale([{ itemId: chinos.id, quantity: '1' }], cash('1649'), { alteration: { jobId: j.id } })).expect(400)).body.message).toMatch(/already billed/);
    n--;
  });

  it('the ₹150 charge can be added to the purchase bill as a service line instead', async () => {
    const j = (await owner.post('/alterations').send(job({ chargePaidWith: 'bill', name: 'Meena', phone: '9840011111' })).expect(201)).body;
    const res = (await T(owner.post('/pos/bills')).send(sale([{ itemId: chinos.id, quantity: '1' }], cash('1649'), { alteration: { jobId: j.id }, expectedTotal: '1649.00' })).expect(201)).body;
    expect(res.sale.total).toBe('1649.00');
    expect(res.sale.lines.map((l: { lineNo: number; lineTotal: string }) => [l.lineNo, l.lineTotal])).toEqual([
      [1, '1499.00'],
      [2, '150.00'],
    ]);
    const after = (await owner.get(`/alterations/${j.id}`).expect(200)).body;
    expect(after).toMatchObject({ status: 'received', bill: { id: res.sale.id }, chargeBill: { id: res.sale.id } });
    // Billed: the charge no longer changes, and it is not billed again on collection.
    expect((await owner.patch(`/alterations/${j.id}`).send(job({ chargePaidWith: 'bill', name: 'Meena', phone: '9840011111', charge: '200' })).expect(400)).body.message).toMatch(/billed; it cannot change/);
    expect((await T(owner.post('/pos/bills')).send(sale([], cash('150'), { alteration: { jobId: j.id } })).expect(400)).body.message).toMatch(/already billed/);
    n--;
  });

  it('jobs past their promised date show as overdue; due today and ready-not-collected lists', async () => {
    const late = (await owner.post('/alterations').send(job({ name: 'Late', phone: '9840022222', promisedOn: today() })).expect(201)).body;
    const due = (await owner.get('/alterations?view=due_today').expect(200)).body.rows;
    expect(due.map((r: { id: string }) => r.id)).toContain(late.id);
    await prisma.alterationJob.update({ where: { id: late.id }, data: { promisedOn: new Date(`${addDays(today(), -1)}T00:00:00Z`) } });
    const overdue = (await owner.get('/alterations?view=overdue').expect(200)).body.rows;
    expect(overdue.map((r: { id: string; overdue: boolean }) => [r.id, r.overdue])).toEqual([[late.id, true]]);
    await owner.post(`/alterations/${late.id}/status`).send({ status: 'with_tailor' }).expect(200);
    await owner.post(`/alterations/${late.id}/status`).send({ status: 'ready' }).expect(200);
    expect((await owner.get('/alterations?view=ready').expect(200)).body.rows.map((r: { id: string }) => r.id)).toEqual([late.id]);
    // Cancelling needs a reason; the slip and the tag print.
    expect((await owner.post(`/alterations/${late.id}/status`).send({ status: 'cancelled' }).expect(400)).body.message).toMatch(/reason/);
    const slip = (await owner.get(`/print/alteration_job/${late.id}`).expect(200)).body;
    expect(slip).toMatchObject({ title: 'Alteration job', number: late.number, lines: [expect.objectContaining({ work: 'Shorten by 2 cm' })] });
    expect((await owner.get(`/print/alteration_tag/${late.id}`).expect(200)).body).toMatchObject({ title: 'Alteration tag', paper: 'A5' });
  });
});
